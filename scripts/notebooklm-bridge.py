#!/usr/bin/env python3
"""
NotebookLM Bridge — Connects ScholarFlow to NotebookLM via notebooklm-py.

Commands (JSON via stdin):
  {"command": "check"}
  {"command": "batch-import", "notebook_url": "...", "urls": ["..."]}
  {"command": "ask", "notebook_url": "...", "question": "...", "session_id": "..."}
  {"command": "list-notebooks"}

Output: JSON via stdout

Prerequisites:
  pip install notebooklm-py
  notebooklm login  (one-time browser auth)
"""

import json
import sys


def check():
    """Check if notebooklm-py is installed and authenticated."""
    try:
        from notebooklm import NotebookLM
        client = NotebookLM()
        notebooks = client.notebooks.list()
        return {
            "status": "success",
            "available": True,
            "authenticated": True,
            "notebook_count": len(notebooks),
        }
    except ImportError:
        return {
            "status": "error",
            "available": False,
            "authenticated": False,
            "error": "notebooklm-py not installed. Run: pip install notebooklm-py",
        }
    except Exception as e:
        err = str(e)
        if "auth" in err.lower() or "login" in err.lower() or "cookie" in err.lower():
            return {
                "status": "error",
                "available": True,
                "authenticated": False,
                "error": "Not authenticated. Run: notebooklm login",
            }
        return {"status": "error", "available": True, "error": err}


def batch_import(notebook_url: str, urls: list):
    """Batch import URLs to a NotebookLM notebook."""
    from notebooklm import NotebookLM

    client = NotebookLM()

    # Extract notebook ID from URL or use directly
    notebook_id = extract_notebook_id(notebook_url)
    if not notebook_id:
        return {"status": "error", "error": f"Cannot extract notebook ID from: {notebook_url}"}

    results = []
    batch_size = 5

    for i in range(0, len(urls), batch_size):
        batch = urls[i : i + batch_size]
        for url in batch:
            try:
                client.sources.add_url(notebook_id, url)
                results.append({"url": url, "status": "success"})
            except Exception as e:
                results.append({"url": url, "status": "error", "error": str(e)})

        # Progress update
        progress = {
            "type": "progress",
            "imported": len(results),
            "total": len(urls),
            "batch": i // batch_size + 1,
        }
        # Write progress to stderr so stdout stays clean for final result
        sys.stderr.write(json.dumps(progress) + "\n")
        sys.stderr.flush()

    succeeded = sum(1 for r in results if r["status"] == "success")
    return {
        "status": "success",
        "imported": succeeded,
        "failed": len(results) - succeeded,
        "total": len(urls),
        "details": results,
    }


def ask(notebook_url: str, question: str, session_id: str = None):
    """Ask a question to the NotebookLM notebook."""
    from notebooklm import NotebookLM

    client = NotebookLM()
    notebook_id = extract_notebook_id(notebook_url)
    if not notebook_id:
        return {"status": "error", "error": f"Cannot extract notebook ID from: {notebook_url}"}

    try:
        response = client.chat.ask(notebook_id, question)
        return {
            "status": "success",
            "answer": response.text if hasattr(response, "text") else str(response),
            "session_id": getattr(response, "session_id", session_id),
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


def list_notebooks():
    """List all available notebooks."""
    from notebooklm import NotebookLM

    client = NotebookLM()
    try:
        notebooks = client.notebooks.list()
        return {
            "status": "success",
            "notebooks": [
                {
                    "id": getattr(nb, "id", str(nb)),
                    "title": getattr(nb, "title", "Untitled"),
                }
                for nb in notebooks
            ],
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


def extract_notebook_id(url_or_id: str) -> str:
    """Extract notebook ID from a NotebookLM share URL or return as-is."""
    if not url_or_id:
        return ""
    # URL format: https://notebooklm.google.com/notebook/NOTEBOOK_ID
    if "notebooklm.google.com" in url_or_id:
        parts = url_or_id.rstrip("/").split("/")
        for i, p in enumerate(parts):
            if p == "notebook" and i + 1 < len(parts):
                return parts[i + 1].split("?")[0]
    # Assume it's already an ID
    return url_or_id


def main():
    input_data = json.loads(sys.stdin.read())
    command = input_data.get("command", "")

    try:
        if command == "check":
            result = check()
        elif command == "batch-import":
            result = batch_import(
                input_data.get("notebook_url", ""),
                input_data.get("urls", []),
            )
        elif command == "ask":
            result = ask(
                input_data.get("notebook_url", ""),
                input_data.get("question", ""),
                input_data.get("session_id"),
            )
        elif command == "list-notebooks":
            result = list_notebooks()
        else:
            result = {"status": "error", "error": f"Unknown command: {command}"}
    except ImportError:
        result = {
            "status": "error",
            "error": "notebooklm-py not installed. Run: pip install notebooklm-py",
        }
    except Exception as e:
        result = {"status": "error", "error": str(e)}

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
