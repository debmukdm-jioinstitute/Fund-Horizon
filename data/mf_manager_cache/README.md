# Cached fund manager pulls from other sites

Drop one CSV per source here (any file name). Columns: `scheme_code, manager_name, manager_start, source, url, fetched_at`.
The API reads them on startup and in the nightly screening run (`app/backoffice/manager_resolver.py`) and fills only the schemes
that have no manager yet. Staff edits and the seed file always win. Only add data a site's robots.txt and terms allow you to collect.
