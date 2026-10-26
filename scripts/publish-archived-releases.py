#!/usr/bin/env python3
"""Publish existing binaries unchanged, verify every asset, and resume safely on rerun."""
import hashlib
import io
import json
import os
from pathlib import Path
import posixpath
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def sha(data):
    return hashlib.sha256(data).hexdigest()


def archives():
    result = []
    for folder in (ROOT / 'releases').iterdir():
        if not folder.is_dir() or not re.fullmatch(r'v\d+\.\d+\.\d+', folder.name):
            continue
        version = folder.name[1:]
        for required in [f'VRCNext-Mobile-{version}.apk', f'VRCNext-Mobile-{version}-source.zip', 'README.md', 'SHA256SUMS.txt']:
            if not (folder / required).is_file():
                raise RuntimeError(f'Missing {folder.name}/{required}')
        for line in (folder / 'SHA256SUMS.txt').read_text().splitlines():
            digest, name = line.split('  ', 1)
            path = (folder / name).resolve()
            if not path.is_relative_to(folder.resolve()) or sha(path.read_bytes()) != digest:
                raise RuntimeError(f'Checksum mismatch: {folder.name}/{name}')
        commit = subprocess.check_output(['git', 'log', '--diff-filter=A', '--format=%H', '--', str(folder.relative_to(ROOT) / 'README.md')], cwd=ROOT, text=True).splitlines()[0]
        result.append((folder, commit))
    return sorted(result, key=lambda item: tuple(map(int, item[0].name[1:].split('.'))))


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        next_req = super().redirect_request(req, fp, code, msg, headers, newurl)
        if next_req and urllib.parse.urlparse(newurl).netloc != 'api.github.com':
            next_req.remove_header('Authorization')
        return next_req


def request(url, method='GET', value=None, data=None, binary=False):
    if not url.startswith('https://') or urllib.parse.urlparse(url).netloc not in ('api.github.com', 'uploads.github.com'):
        raise RuntimeError('Unexpected GitHub endpoint')
    headers = {'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'User-Agent': 'VRCNext-Mobile-release-publisher', 'Accept': 'application/octet-stream' if binary else 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
    if value is not None:
        data = json.dumps(value).encode()
        headers['Content-Type'] = 'application/json'
    elif data is not None:
        headers['Content-Type'] = 'application/octet-stream'
    try:
        with urllib.request.build_opener(SafeRedirect()).open(urllib.request.Request(url, data=data, headers=headers, method=method), timeout=120) as response:
            content = response.read()
            return content if binary else json.loads(content) if content else None
    except urllib.error.HTTPError as error:
        if error.code == 404 and method == 'GET' and not binary:
            return None
        raise RuntimeError(f'GitHub {method} failed: HTTP {error.code}') from None


def notes(folder, repository):
    def link(match):
        label, target = match.groups()
        name = target.rsplit('/', 1)[-1]
        if (target == name or target.endswith('/' + folder.name + '/' + name)) and (folder / name).is_file():
            target = f'https://github.com/{repository}/releases/download/{folder.name}/{name}'
        elif not re.match(r'^(?:https?://|#)', target):
            relative = posixpath.normpath((folder.relative_to(ROOT) / target).as_posix())
            kind = 'tree' if (ROOT / relative).is_dir() else 'blob'
            target = f'https://github.com/{repository}/{kind}/main/{relative}'
        return f'[{label}]({target})'
    return re.sub(r'\[([^\]]+)\]\(([^\s)]+)\)', link, (folder / 'README.md').read_text()) + '\n\nПолная копия каталога, включая снимки интерфейса: архив `release-files.zip` в Assets. APK и исходники сохранены без пересборки.\n'


def main():
    plan = archives()
    if '--check' in sys.argv:
        print(json.dumps([{'tag': p.name, 'target': c, 'files': sum(x.is_file() for x in p.rglob('*'))} for p, c in plan], indent=2))
        return
    repository = os.environ['RELEASE_REPOSITORY']
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise RuntimeError('Invalid repository')
    api = f'https://api.github.com/repos/{repository}'
    records = []
    for folder, commit in plan:
        tag = folder.name
        existing_tag = subprocess.run(['git', 'rev-parse', '--verify', '--quiet', tag + '^{commit}'], cwd=ROOT, text=True, capture_output=True)
        if existing_tag.returncode == 0 and existing_tag.stdout.strip() != commit:
            raise RuntimeError(f'Tag {tag} already points to a different commit')
        release = request(api + '/releases/tags/' + tag)
        if not release:
            # An interrupted attempt may already have created a draft.
            page = 1
            while True:
                batch = request(api + f'/releases?per_page=100&page={page}') or []
                release = next((item for item in batch if item['tag_name'] == tag), None)
                if release or len(batch) < 100:
                    break
                page += 1
        if not release:
            release = request(api + '/releases', 'POST', {'tag_name': tag, 'target_commitish': commit, 'name': 'VRCNext Mobile ' + tag[1:], 'body': notes(folder, repository), 'draft': True, 'prerelease': False, 'make_latest': 'false'})
        assets = []
        with tempfile.TemporaryDirectory() as temporary:
            bundle = Path(temporary) / 'release-files.zip'
            with zipfile.ZipFile(bundle, 'w', zipfile.ZIP_DEFLATED) as archive:
                for path in sorted(folder.rglob('*')):
                    if path.is_file():
                        info = zipfile.ZipInfo(path.relative_to(folder).as_posix(), (2026, 1, 1, 0, 0, 0))
                        info.compress_type = zipfile.ZIP_DEFLATED
                        archive.writestr(info, path.read_bytes())
            paths = sorted(p for p in folder.iterdir() if p.is_file()) + [bundle]
            existing = request(api + f'/releases/{release["id"]}/assets?per_page=100') or []
            for path in paths:
                data = path.read_bytes()
                asset = next((item for item in existing if item['name'] == path.name), None)
                if asset and path == bundle:
                    # ZIP compression can differ between Python/zlib versions. Verify the
                    # original directory contents instead of replacing a published bundle.
                    data = request(asset['url'], binary=True)
                    with zipfile.ZipFile(io.BytesIO(data)) as saved:
                        originals = {p.relative_to(folder).as_posix(): p for p in folder.rglob('*') if p.is_file()}
                        if len(saved.namelist()) != len(originals) or set(saved.namelist()) != set(originals):
                            raise RuntimeError(f'Existing bundle contents differ: {tag}')
                        for name, original in originals.items():
                            if sha(saved.read(name)) != sha(original.read_bytes()):
                                raise RuntimeError(f'Existing bundle file differs: {tag}/{name}')
                if not asset:
                    asset = request(release['upload_url'].split('{')[0] + '?' + urllib.parse.urlencode({'name': path.name}), 'POST', data=data)
                # Never overwrite a different published file on a rerun.
                if asset['size'] != len(data):
                    raise RuntimeError(f'Existing asset differs: {tag}/{path.name}')
                digest = asset.get('digest')
                if digest:
                    verified = digest == 'sha256:' + sha(data)
                else:
                    verified = sha(request(asset['url'], binary=True)) == sha(data)
                if not verified:
                    raise RuntimeError(f'Asset digest differs: {tag}/{path.name}')
                assets.append({'name': path.name, 'bytes': len(data), 'sha256': sha(data), 'url': asset['browser_download_url']})
        if release['draft']:
            release = request(api + f'/releases/{release["id"]}', 'PATCH', {'draft': False, 'make_latest': 'true' if folder == plan[-1][0] else 'false'})
            # Draft uploads use temporary untagged URLs. Read the published URLs
            # after GitHub has assigned the actual version tag.
            published = request(api + f'/releases/{release["id"]}/assets?per_page=100') or []
            for item in assets:
                current = next((asset for asset in published if asset['name'] == item['name']), None)
                if not current or current['size'] != item['bytes']:
                    raise RuntimeError(f'Published asset missing: {tag}/{item["name"]}')
                if current.get('digest') and current['digest'] != 'sha256:' + item['sha256']:
                    raise RuntimeError(f'Published asset changed: {tag}/{item["name"]}')
                item['url'] = current['browser_download_url']
        records.append({'tag': tag, 'targetCommit': commit, 'url': release['html_url'], 'assets': assets})
        print(f'Verified {tag}: {len(assets)} assets', flush=True)
    (ROOT / 'releases/github-publication.json').write_text(json.dumps({'repository': repository, 'releases': records}, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
