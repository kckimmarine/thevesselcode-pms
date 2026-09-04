const findings = require('./helpers/findings');

module.exports = async function globalSetup() {
  findings.reset();
};
