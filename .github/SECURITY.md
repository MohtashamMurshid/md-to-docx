# Security policy

md-to-docx converts untrusted Markdown and DOCX input. It fetches remote images behind an SSRF guard and parses ZIP and XML from reference documents, so reports in those areas are especially welcome.

## Reporting a vulnerability

Report privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability**. If that option is not available, open an issue that says only that you have a security report and asks for a private contact. Do not include any details in the issue.

Include what is affected, how to reproduce it (a minimal Markdown or DOCX input is ideal), and what an attacker could achieve.

## Supported versions

Fixes go into the latest release line only. semantic-release publishes them as a patch release from `main`.

## Scope

This repository covers the library, the `md-to-docx` CLI and the published agent skill. Report a problem in a dependency, such as `docx`, `jszip` or `undici`, to that project. Tell us too if it affects md-to-docx.
