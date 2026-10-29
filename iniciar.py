from __future__ import annotations

import subprocess
import sys
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main() -> None:
    backend = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"],
        cwd=ROOT,
    )
    frontend = subprocess.Popen(
        ["npm", "run", "dev", "--", "--host", "0.0.0.0"],
        cwd=ROOT,
        shell=sys.platform.startswith("win"),
    )
    try:
        time.sleep(3)
        webbrowser.open("http://localhost:5173")
        print("Sistema disponível em http://localhost:5173")
        print("Pressione Ctrl+C para encerrar.")
        frontend.wait()
    except KeyboardInterrupt:
        pass
    finally:
        frontend.terminate()
        backend.terminate()


if __name__ == "__main__":
    main()
