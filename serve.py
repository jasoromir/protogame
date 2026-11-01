"""Local dev server for the prototype: this computer only (127.0.0.1), no browser caching."""
import functools
import http.server
import os
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    handler = functools.partial(NoCache, directory=os.path.dirname(os.path.abspath(__file__)))
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
