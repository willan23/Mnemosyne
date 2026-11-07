'use strict';

/** Match Functions and CI before starting emulator subprocesses. */
function checkNodeVersion(version = process.versions.node) {
  const match = typeof version === 'string' && /^v?(\d+)\.\d+\.\d+$/.exec(version);
  if (!match || Number(match[1]) !== 22) {
    throw new Error('Os testes Firebase Emulator exigem Node 22 para reproduzir Functions e CI. Confirma node --version e o PATH antes de repetir.');
  }
  return 22;
}

if (require.main === module) {
  try {
    console.log(`Node ${checkNodeVersion()} confirmado para Firebase Emulator.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkNodeVersion };
