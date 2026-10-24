"""只打包扩展运行文件，分别生成 Chromium 和 Firefox 安装包。"""

import copy
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def package():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    files = sorted(path.relative_to(ROOT).as_posix() for path in (ROOT / "src").rglob("*")
                   if path.is_file() and path.suffix in {".js", ".css", ".html"})
    files += sorted(set(manifest["icons"].values()))
    referenced = [manifest["options_page"], manifest["action"]["default_popup"]]
    for script in manifest["content_scripts"]:
        referenced += script.get("js", []) + script.get("css", [])
    if any(path not in files for path in referenced):
        raise ValueError("清单引用了未纳入安装包的运行文件")
    for file in files:
        path = (ROOT / file).resolve()
        if not path.is_relative_to(ROOT) or not path.is_file():
            raise ValueError(f"安装包文件缺失或超出项目范围：{file}")
    destination = ROOT / "dist"
    destination.mkdir(exist_ok=True)
    for browser in ["chromium", "firefox"]:
        metadata = copy.deepcopy(manifest)
        if browser == "chromium":
            metadata.pop("browser_specific_settings", None)
        output = destination / f"chatgpt-outline-navigator-{manifest['version']}-{browser}.zip"
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
            for file in files:
                archive.write(ROOT / file, file)
        with zipfile.ZipFile(output) as archive:
            if archive.testzip() is not None:
                raise ValueError(f"安装包校验失败：{output}")
        print(f"已生成：{output}（{len(files) + 1} 个文件，{output.stat().st_size} 字节）")


if __name__ == "__main__":
    package()
