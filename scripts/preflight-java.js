'use strict';

const { spawnSync } = require('node:child_process');

function javaMajor(versionOutput) {
  const match = /(?:openjdk|java) version "(\d+)(?:[.\"])/i.exec(versionOutput);
  return match ? Number(match[1]) : null;
}

function checkJavaVersion(run = spawnSync) {
  const result = run('java', ['-version'], { encoding: 'utf8' });
  const major = javaMajor(`${result.stdout || ''}\n${result.stderr || ''}`);
  if (result.error || result.status !== 0 || major === null || major < 21) {
    throw new Error(`Os testes Firebase Emulator exigem JDK 21 ou superior. Versão detetada: ${major ?? 'indisponível'}. Define JAVA_HOME para JDK 21+ e repete.`);
  }
  return major;
}

if (require.main === module) {
  try {
    console.log(`Java ${checkJavaVersion()} confirmado para Firebase Emulator.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { javaMajor, checkJavaVersion };
