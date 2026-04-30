const { closeDatabase } = require("../src/db");
const { importTrainingData } = require("../src/crate/trainingImport");

try {
  const result = importTrainingData({
    exportPath: process.env.TRAINING_EXPORT_PATH,
  });

  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  closeDatabase();
}
