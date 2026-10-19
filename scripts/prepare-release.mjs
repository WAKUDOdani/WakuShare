// Create a local tag only. Publishing requires an explicit git push.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Use a stable semver version')
if (git('status', '--porcelain')) throw new Error('Commit all changes before tagging')
if (git('remote', 'get-url', 'origin') !== 'https://github.com/WAKUDOdani/WakuShare.git')
  throw new Error('Unexpected release repository')
const tag = `v${pkg.version}`
git('tag', '-a', tag, '-m', `WakuShare ${tag}`)
console.log(`Created local ${tag}. Review, then push main and this tag explicitly.`)
