import assert from 'node:assert/strict'

const repository = 'JusticeSc/harness-governance-public-acceptance-20261023-c7a4'
const owner = 'JusticeSc'
const title = 'Governance Acceptance 20261023 c7a4'
const projectToken = process.env.PROJECT_TOKEN
const repositoryToken = process.env.GITHUB_TOKEN
const observation = {
  schema: 'governance-project-credential-observation/v1',
  startedAt: new Date().toISOString(),
  repository,
  branch: process.env.GITHUB_REF,
  commit: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  secretName: 'GOVERNANCE_TEST_PROJECT_TOKEN',
  operations: [],
  transitions: [],
  productionTouched: false,
  status: 'in-progress',
  scope: 'Credential and isolated Project API capability only; not migrated lifecycle-policy or C5 acceptance.',
}

async function request(operation, token, path, body, method = 'POST') {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'isolated-governance-project-acceptance',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  })
  observation.operations.push({
    operation,
    method,
    path,
    httpStatus: response.status,
    requestId: response.headers.get('x-github-request-id'),
    observedAt: new Date().toISOString(),
  })
  if (!response.ok) throw new Error(`${operation}: HTTP ${response.status}`)
  const result = await response.json()
  if (result.errors?.length) {
    throw new Error(`${operation}: ${result.errors.map(error => error.message).join('; ')}`)
  }
  return result
}

async function graphql(operation, query, variables) {
  const result = await request(operation, projectToken, '/graphql', { query, variables })
  return result.data
}

async function readStatus(itemId, projectId) {
  const data = await graphql('read-item-status', `query($id:ID!){node(id:$id){... on ProjectV2Item{id project{id} content{... on Issue{id number repository{nameWithOwner}}} fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name optionId}}}}}`, { id: itemId })
  assert.equal(data.node?.project.id, projectId)
  assert.equal(data.node?.content.repository.nameWithOwner, repository)
  assert.equal(data.node?.content.number, observation.issue.number)
  return data.node.fieldValueByName?.name ?? null
}

try {
  assert.equal(process.env.GITHUB_REPOSITORY, repository)
  assert.equal(process.env.GITHUB_EVENT_NAME, 'push')
  assert.equal(process.env.GITHUB_REF, 'refs/heads/acceptance/project-secret-validation')
  assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1', 'Do not rerun Project creation; retain the original run and reuse its Project ID.')
  assert.ok(projectToken, 'Configured repository Secret was not supplied to this job')
  assert.ok(repositoryToken, 'Workflow repository token is missing')

  const identity = await graphql('read-authorized-owner', 'query($login:String!){viewer{login} user(login:$login){id login}}', { login: owner })
  assert.equal(identity.viewer.login, owner, 'Project credential must belong to the authorized isolated-Project owner')
  assert.equal(identity.user?.login, owner)
  observation.credentialActor = identity.viewer.login

  const created = await graphql('create-one-isolated-project', 'mutation($owner:ID!,$title:String!){createProjectV2(input:{ownerId:$owner,title:$title}){projectV2{id number title url public owner{... on User{login} ... on Organization{login}}}}}', { owner: identity.user.id, title })
  observation.project = created.createProjectV2.projectV2
  console.log(`GOVERNANCE_PROJECT_CREATED=${JSON.stringify(observation.project)}`)
  assert.equal(observation.project.owner.login, owner)
  assert.equal(observation.project.title, title)
  assert.equal(observation.project.public, false)

  const context = await graphql('read-created-project-fields', 'query($id:ID!){node(id:$id){... on ProjectV2{id title fields(first:20){nodes{... on ProjectV2SingleSelectField{id name options{id name}}}}}}}', { id: observation.project.id })
  assert.equal(context.node?.id, observation.project.id)
  assert.equal(context.node?.title, title)
  const status = context.node.fields.nodes.find(field => field?.name === 'Status')
  assert.ok(status, 'New Project has no Status single-select field')
  const expectedStatuses = ['Todo', 'In Progress', 'Done']
  for (const name of expectedStatuses) assert.ok(status.options.some(option => option.name === name), `New Project is missing Status option ${name}`)

  const issue = await request('create-isolated-acceptance-issue', repositoryToken, `/repos/${repository}/issues`, {
    title: 'Project Secret acceptance — isolated fixture',
    body: `Synthetic credential-capability fixture only. No production work or business data.\n\nProject: ${observation.project.url}\n\nRun: https://github.com/${repository}/actions/runs/${observation.runId}\n\nThis run does not prove migrated lifecycle policy or full governance acceptance.`,
  })
  assert.equal(issue.repository_url, `https://api.github.com/repos/${repository}`)
  observation.issue = { id: issue.node_id, number: issue.number, url: issue.html_url }
  const added = await graphql('associate-only-acceptance-issue', 'mutation($project:ID!,$issue:ID!){addProjectV2ItemById(input:{projectId:$project,contentId:$issue}){item{id}}}', { project: observation.project.id, issue: issue.node_id })
  observation.itemId = added.addProjectV2ItemById.item.id

  for (const name of expectedStatuses) {
    const option = status.options.find(candidate => candidate.name === name)
    await graphql(`set-status-${name}`, 'mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}}', { project: observation.project.id, item: observation.itemId, field: status.id, option: option.id })
    const actual = await readStatus(observation.itemId, observation.project.id)
    assert.equal(actual, name)
    observation.transitions.push({ expected: name, actual, observedAt: new Date().toISOString() })
  }
  const closed = await request('close-only-acceptance-issue', repositoryToken, `/repos/${repository}/issues/${issue.number}`, { state: 'closed', state_reason: 'completed' }, 'PATCH')
  assert.equal(closed.state, 'closed')
  observation.issue.state = closed.state
  observation.finalStatus = await readStatus(observation.itemId, observation.project.id)
  assert.equal(observation.finalStatus, 'Done')
  observation.status = 'credential-and-isolated-project-capability-observed'
} catch (error) {
  observation.status = 'failed'
  observation.error = String(error?.message ?? error)
  process.exitCode = 1
} finally {
  observation.completedAt = new Date().toISOString()
  let output = JSON.stringify(observation)
  for (const secret of [projectToken, repositoryToken]) {
    if (secret) output = output.split(secret).join('[REDACTED]')
  }
  console.log(`GOVERNANCE_PROJECT_OBSERVATION=${output}`)
}
