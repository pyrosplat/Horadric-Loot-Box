use std::path::Path;

/// Builds the vendored CascLib (plus a small C shim) as a static library. Only a C/C++ compiler is needed
/// (MSVC on Windows, gcc/clang elsewhere): no CMake, no bindgen.
fn build_casclib() {
    let root = Path::new("vendor/CascLib/src");
    let cpp = [
        "common/Common.cpp",
        "common/Directory.cpp",
        "common/Csv.cpp",
        "common/FileStream.cpp",
        "common/FileTree.cpp",
        "common/ListFile.cpp",
        "common/Mime.cpp",
        "common/RootHandler.cpp",
        "common/Sockets.cpp",
        "hashes/md5.cpp",
        "hashes/sha1.cpp",
        "overwatch/apm.cpp",
        "overwatch/cmf.cpp",
        "overwatch/aes.cpp",
        "CascDecompress.cpp",
        "CascDecrypt.cpp",
        "CascDumpData.cpp",
        "CascFiles.cpp",
        "CascFindFile.cpp",
        "CascIndexFiles.cpp",
        "CascOpenFile.cpp",
        "CascOpenStorage.cpp",
        "CascReadFile.cpp",
        "CascRootFile_Diablo3.cpp",
        "CascRootFile_Install.cpp",
        "CascRootFile_MNDX.cpp",
        "CascRootFile_Text.cpp",
        "CascRootFile_TVFS.cpp",
        "CascRootFile_OW.cpp",
        "CascRootFile_WoW.cpp",
    ];
    let c = [
        "jenkins/lookup3.c",
        "zlib/adler32.c",
        "zlib/crc32.c",
        "zlib/inffast.c",
        "zlib/inflate.c",
        "zlib/inftrees.c",
        "zlib/zutil.c",
    ];
    let windows = std::env::var("CARGO_CFG_TARGET_OS")
        .map(|o| o == "windows")
        .unwrap_or(false);

    let mut b = cc::Build::new();
    b.cpp(true)
        .warnings(false)
        .define("CASCLIB_NO_AUTO_LINK_LIBRARY", None)
        .define("CASCLIB_NODEBUG", None);
    if windows {
        b.define("UNICODE", None)
            .define("_UNICODE", None)
            .define("CASCLIB_UNICODE", None);
    } else {
        // CascPort.h doesn't define this Windows typedef on other platforms
        b.define("LPDWORD", Some("DWORD*"));
    }
    for f in cpp {
        b.file(root.join(f));
    }
    b.file("native/hlb_casc.cpp");
    b.compile("hvcasc");

    let mut z = cc::Build::new();
    z.warnings(false);
    if windows {
        z.define("UNICODE", None).define("_UNICODE", None);
    }
    for f in c {
        z.file(root.join(f));
    }
    z.compile("hvcasc_c");

    if windows {
        println!("cargo:rustc-link-lib=wininet");
        println!("cargo:rustc-link-lib=ws2_32");
    }
    println!("cargo:rerun-if-changed=native/hlb_casc.cpp");
    println!("cargo:rerun-if-changed=vendor/CascLib/src");
}

fn main() {
    build_casclib();
    tauri_build::build()
}
