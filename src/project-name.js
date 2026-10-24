const name = process.argv.slice(2).join(' ').trim().replace(/[ \t]+/gu, ' ')
if (!name || /[\r\n]/u.test(name)) {
  console.error('Project name is required')
  process.exitCode = 2
} else {
  console.log(name)
}
