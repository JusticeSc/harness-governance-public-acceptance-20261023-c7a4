// Authorized fixture only. This file and its workflow are removed by repair-policy.
const repository = 'JusticeSc/harness-governance-public-acceptance-20261023-c7a4'
if (process.env.GITHUB_REPOSITORY !== repository) throw new Error('Refusing another repository')
if (!process.env.GH_TOKEN) throw new Error('A runtime-only Actions token is required')
const phase = process.env.PHASE
const allowed = new Set(['open-business', 'bump-business', 'open-policy', 'forge-policy-status', 'open-delegation', 'repair-policy'])
if (!allowed.has(phase)) throw new Error('Unknown finite operation')
const root = `https://api.github.com/repos/${repository}`
const branches = {
  business: 'acceptance/trusted-business',
  policy: 'acceptance/trusted-policy',
  delegation: 'acceptance/trusted-delegation',
}
async function api(method, path, body) {
  const response = await fetch(`${root}/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.GH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data)}`)
  return data
}
async function readFile(path, branch) {
  const result = await api('GET', `contents/${path}?ref=${encodeURIComponent(branch)}`)
  return { sha: result.sha, text: Buffer.from(result.content, 'base64').toString('utf8') }
}
async function changeFile(path, branch, transform, message) {
  const old = await readFile(path, branch)
  const text = transform(old.text)
  if (text === old.text) throw new Error(`Expected an actual change: ${path}`)
  await api('PUT', `contents/${path}`, { branch, sha: old.sha, message, content: Buffer.from(text).toString('base64') })
}
function replaceExactly(text, old, next) {
  if (text.split(old).length !== 2) throw new Error('Fixture precondition changed')
  return text.replace(old, next)
}
async function openPull(kind) {
  const branch = branches[kind]
  const base = await api('GET', 'git/ref/heads/main')
  await api('POST', 'git/refs', { ref: `refs/heads/${branch}`, sha: base.object.sha })
  if (kind === 'business') {
    await changeFile('src/project-name.js', branch,
      text => replaceExactly(text, ".join(' ').trim()", ".join(' ').trim().replace(/[ \\t]+/gu, ' ')"),
      'Normalize repeated spaces in project labels')
  } else if (kind === 'policy') {
    await changeFile('.github/review-ownership/approval-policy.json', branch, text => {
      const policy = JSON.parse(text)
      if (policy.requiredPoints !== 2) throw new Error('Unexpected trusted baseline')
      return JSON.stringify({ ...policy, requiredPoints: 0 }, null, 2) + '\n'
    }, 'UNAPPROVED control: try weakening the required approval threshold')
  } else {
    await changeFile('src/project-name.js', branch,
      text => replaceExactly(text, 'if (!name || /[\\r\\n]/u.test(name)) {', 'if (!name || /[\\r\\n]/u.test(name) || name.length > 128) {'),
      'Bound project-label length for the delegated-review scenario')
  }
  const pull = await api('POST', 'pulls', {
    title: `Authorized governance acceptance: ${kind}`,
    head: branch,
    base: 'main',
    body: 'Isolated, user-authorized governance acceptance. A bot author allows a distinct real reviewer. This is not an approval and no secret is recorded. Preserve initial failures and real platform decisions.',
  })
  console.log(JSON.stringify({ operation: phase, pull: pull.number, url: pull.html_url, author: pull.user.login, head: pull.head.sha, base: pull.base.sha }))
}
async function currentPull(kind) {
  const pulls = await api('GET', `pulls?state=open&head=${encodeURIComponent(`JusticeSc:${branches[kind]}`)}`)
  if (pulls.length !== 1 || pulls[0].head.repo.full_name !== repository) throw new Error('Expected exactly one matching open fixture PR')
  return pulls[0]
}
console.log(JSON.stringify({ phase, node: process.version, platform: process.platform, repository, run: process.env.GITHUB_RUN_ID }))
if (phase.startsWith('open-')) {
  await openPull(phase.slice(5))
} else if (phase === 'bump-business') {
  const pull = await currentPull('business')
  await changeFile('src/project-name.js', pull.head.ref,
    text => replaceExactly(text, 'if (!name) {', 'if (!name || /[\\r\\n]/u.test(name)) {'),
    'Reject multiline labels and invalidate the prior head approval')
  console.log(JSON.stringify({ operation: phase, pull: pull.number, branch: pull.head.ref }))
} else if (phase === 'forge-policy-status') {
  const pull = await currentPull('policy')
  const status = await api('POST', `statuses/${pull.head.sha}`, {
    state: 'success', context: 'weighted approval',
    description: 'AUTHORIZED same-App confusion control, NOT scorer approval',
    target_url: `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  })
  console.log(JSON.stringify({ operation: phase, pull: pull.number, head: pull.head.sha, statusId: status.id, creator: status.creator.login, state: status.state }))
} else {
  const pull = await currentPull('policy')
  const branch = pull.head.ref
  const trusted = await readFile('.github/review-ownership/approval-policy.json', 'main')
  if (JSON.parse(trusted.text).requiredPoints !== 2) throw new Error('Trusted policy changed')
  // The authenticated owner prepares workflow changes first; this bot only
  // writes source/policy, and its final reviewable push remains independently reviewable.
  const githubFiles = await api('GET', `contents/.github?ref=${encodeURIComponent(branch)}`)
  const workflows = await api('GET', `contents/.github/workflows?ref=${encodeURIComponent(branch)}`)
  if (githubFiles.some(entry => entry.name === 'fixture-control.mjs') ||
      workflows.some(entry => entry.name === 'fixture-controls.yml')) {
    throw new Error('Owner must remove temporary controls on this PR branch before the final bot source change')
  }
  const businessCheck = await readFile('.github/workflows/fixture-business.yml', branch)
  if (!businessCheck.text.includes("'Invalid project name'")) {
    throw new Error('Owner must prepare the matching business check first')
  }
  await changeFile('.github/review-ownership/approval-policy.json', branch, () => trusted.text, 'Restore the trusted approval policy without weakening')
  await changeFile('src/project-name.js', branch,
    text => replaceExactly(text, 'Project name is required', 'Invalid project name'),
    'Report invalid labels consistently for the recovered business path')
  console.log(JSON.stringify({ operation: phase, pull: pull.number, branch, verifiedTemporaryControlsRemoved: true }))
}
