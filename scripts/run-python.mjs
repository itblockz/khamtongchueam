import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'

const projectRoot = process.cwd()
const venvPython = process.platform === 'win32'
  ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
  : path.join(projectRoot, '.venv', 'bin', 'python')

const pythonCommand = existsSync(venvPython) ? venvPython : 'python'
const args = process.argv.slice(2)

if (args.length === 0) {
  console.error('No Python command arguments were provided.')
  process.exit(1)
}

const child = spawn(pythonCommand, args, {
  stdio: 'inherit',
  cwd: projectRoot,
  shell: false,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})

child.on('error', (error) => {
  console.error(`Failed to launch Python with "${pythonCommand}":`, error)
  process.exit(1)
})
