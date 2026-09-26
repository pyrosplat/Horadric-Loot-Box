// Thin C shim over CascLib so the Rust side never has to mirror CascLib's structs.
// Opens the local Diablo II: Resurrected storage read-only and reads files by name.

#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#include "../vendor/CascLib/src/CascLib.h"

#ifdef _WIN32
#include <windows.h>
#endif

extern "C" {

// Opens the CASC storage in `utf8_path` (the game folder that holds `.build.info` and `Data/`).
// Returns NULL on failure; `err` receives CascLib's error code.
void *hlb_casc_open(const char *utf8_path, uint32_t *err) {
    HANDLE h = NULL;
#if defined(_WIN32) && defined(UNICODE)
    int n = MultiByteToWideChar(CP_UTF8, 0, utf8_path, -1, NULL, 0);
    if (n <= 0) { if (err) *err = 87; return NULL; }
    wchar_t *wide = (wchar_t *)malloc(sizeof(wchar_t) * (size_t)n);
    if (!wide) { if (err) *err = 8; return NULL; }
    MultiByteToWideChar(CP_UTF8, 0, utf8_path, -1, wide, n);
    bool ok = CascOpenStorage(wide, 0, &h);
    free(wide);
#else
    bool ok = CascOpenStorage(utf8_path, 0, &h);
#endif
    if (!ok) {
        if (err) *err = GetCascError();
        return NULL;
    }
    if (err) *err = 0;
    return h;
}

void hlb_casc_close(void *storage) {
    if (storage) CascCloseStorage((HANDLE)storage);
}

// Reads a whole file. On success returns 0 and hands back a malloc'd buffer (free with hlb_casc_free).
uint32_t hlb_casc_read(void *storage, const char *name, uint8_t **out, uint64_t *len) {
    HANDLE f = NULL;
    *out = NULL;
    *len = 0;
    if (!CascOpenFile((HANDLE)storage, name, 0, CASC_OPEN_BY_NAME, &f)) return GetCascError();
    ULONGLONG size = 0;
    if (!CascGetFileSize64(f, &size) || size > 256ull * 1024 * 1024) {
        uint32_t e = GetCascError();
        CascCloseFile(f);
        return e ? e : 22;
    }
    uint8_t *buf = (uint8_t *)malloc(size ? (size_t)size : 1);
    if (!buf) {
        CascCloseFile(f);
        return 8;
    }
    uint64_t done = 0;
    while (done < size) {
        DWORD want = (DWORD)((size - done) > 0x1000000 ? 0x1000000 : (size - done));
        DWORD got = 0;
        if (!CascReadFile(f, buf + done, want, &got) || got == 0) {
            uint32_t e = GetCascError();
            free(buf);
            CascCloseFile(f);
            return e ? e : 5;
        }
        done += got;
    }
    CascCloseFile(f);
    *out = buf;
    *len = done;
    return 0;
}

int hlb_casc_exists(void *storage, const char *name) {
    HANDLE f = NULL;
    if (!CascOpenFile((HANDLE)storage, name, 0, CASC_OPEN_BY_NAME, &f)) return 0;
    CascCloseFile(f);
    return 1;
}

void hlb_casc_free(uint8_t *p) { free(p); }

typedef void (*hlb_name_cb)(const char *name, void *ctx);

// Calls `cb` for every file whose name matches `mask` (CascLib wildcards). Returns the number of names.
uint32_t hlb_casc_list(void *storage, const char *mask, hlb_name_cb cb, void *ctx) {
    CASC_FIND_DATA fd;
    memset(&fd, 0, sizeof(fd));
    HANDLE find = CascFindFirstFile((HANDLE)storage, mask, &fd, NULL);
    if (find == NULL || find == INVALID_HANDLE_VALUE) return 0;
    uint32_t n = 0;
    do {
        if (fd.NameType == CascNameFull) {
            cb(fd.szFileName, ctx);
            n++;
        }
    } while (CascFindNextFile(find, &fd));
    CascFindClose(find);
    return n;
}

}  // extern "C"
