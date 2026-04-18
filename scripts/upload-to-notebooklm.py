#!/usr/bin/env python3
"""
Upload papers to NotebookLM automatically.

Usage:
  python scripts/upload-to-notebooklm.py --notebook-id <ID> --urls <url1> <url2> ...
  python scripts/upload-to-notebooklm.py --notebook-id <ID> --file papers.json
  python scripts/upload-to-notebooklm.py --notebook-id <ID> --pdf-dir ./papers/

The notebook-id is the UUID from your NotebookLM URL:
  https://notebooklm.google.com/notebook/<notebook-id>

Requires: notebooklm-mcp-cli (already installed via uv)
"""

import argparse
import json
import sys
from pathlib import Path


def get_client():
    """Initialize NotebookLM client using existing MCP auth."""
    try:
        from notebooklm_tools.core.client import NotebookLMClient
        client = NotebookLMClient()
        return client
    except ImportError:
        print("Error: notebooklm-mcp-cli not found.")
        print("Install with: uv tool install notebooklm-mcp-cli")
        sys.exit(1)


def upload_urls(client, notebook_id: str, urls: list[str]):
    """Add URL sources to a notebook."""
    print(f"Adding {len(urls)} URL sources to notebook {notebook_id}...")

    # Filter out empty/invalid URLs
    valid_urls = [u for u in urls if u and u.startswith("http")]
    if not valid_urls:
        print("No valid URLs to add.")
        return

    # Add in batches of 5
    batch_size = 5
    total_added = 0
    for i in range(0, len(valid_urls), batch_size):
        batch = valid_urls[i:i + batch_size]
        print(f"  Batch {i // batch_size + 1}: adding {len(batch)} URLs...")
        try:
            results = client.add_url_sources(notebook_id, batch, wait=True, wait_timeout=120)
            for r in results:
                if r.get("id"):
                    print(f"    ✓ {r.get('title', 'Unknown')}")
                    total_added += 1
                else:
                    print(f"    ✗ Failed: {r}")
        except Exception as e:
            print(f"    ✗ Batch failed: {e}")

    print(f"\nDone! Added {total_added}/{len(valid_urls)} sources.")


def upload_pdfs(client, notebook_id: str, pdf_dir: str):
    """Upload PDF files from a directory."""
    pdf_path = Path(pdf_dir)
    if not pdf_path.exists():
        print(f"Directory not found: {pdf_dir}")
        return

    pdfs = list(pdf_path.glob("*.pdf"))
    if not pdfs:
        print(f"No PDF files found in {pdf_dir}")
        return

    print(f"Uploading {len(pdfs)} PDF files to notebook {notebook_id}...")
    total_added = 0
    for pdf in pdfs:
        print(f"  Uploading {pdf.name}...", end=" ")
        try:
            result = client.add_file(notebook_id, str(pdf), wait=True, wait_timeout=180)
            if result.get("id"):
                print("✓")
                total_added += 1
            else:
                print(f"✗ {result}")
        except Exception as e:
            print(f"✗ {e}")

    print(f"\nDone! Uploaded {total_added}/{len(pdfs)} PDFs.")


def main():
    parser = argparse.ArgumentParser(description="Upload papers to NotebookLM")
    parser.add_argument("--notebook-id", required=True, help="NotebookLM notebook UUID")
    parser.add_argument("--urls", nargs="+", help="URLs to add as sources")
    parser.add_argument("--file", help="JSON file with paper URLs (from ScholarFlow export)")
    parser.add_argument("--pdf-dir", help="Directory containing PDF files to upload")
    args = parser.parse_args()

    client = get_client()

    if args.urls:
        upload_urls(client, args.notebook_id, args.urls)
    elif args.file:
        with open(args.file) as f:
            data = json.load(f)
        urls = []
        for paper in data if isinstance(data, list) else data.get("papers", []):
            url = paper.get("openAccessPdf") or paper.get("pdfUrl")
            if url:
                urls.append(url)
            elif paper.get("doi"):
                urls.append(f"https://doi.org/{paper['doi']}")
        upload_urls(client, args.notebook_id, urls)
    elif args.pdf_dir:
        upload_pdfs(client, args.notebook_id, args.pdf_dir)
    else:
        print("Provide --urls, --file, or --pdf-dir")
        parser.print_help()


if __name__ == "__main__":
    main()
