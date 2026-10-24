const name = process.argv.slice(2).join(' ').trim().replace(/[ \t]+/gu, ' ')
if (!name) {
  console.error('Project name is required')
  process.exitCode = 2
} else {
  console.log(name)
}
