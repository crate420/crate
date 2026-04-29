const config = require("../src/config");

async function main() {
  const response = await fetch(`http://localhost:${config.port}/health`);

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }

  const body = await response.json();
  console.log(JSON.stringify(body, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
