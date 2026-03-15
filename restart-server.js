const { execSync } = require('child_process');

try {
  console.log('Finding node src/server.js processes...')
  const out = execSync(`powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*src/server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Output \\"Killed $_.ProcessId\\" }"`);
  console.log(out.toString());
} catch (e) {
  console.log('None found or error killing.');
}
