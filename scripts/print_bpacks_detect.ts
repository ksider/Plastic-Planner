import fs from "fs";
import path from "path";
import { parseBpacksMatrix } from "../src/bpacks_import.js";

const filePath = path.join(process.cwd(), "BPACKs Sheet - TPS PURE.csv");
if (!fs.existsSync(filePath)) {
  console.error(`Missing file: ${filePath}`);
  process.exit(1);
}

const text = fs.readFileSync(filePath, "utf8");
const parsed = parseBpacksMatrix(text);

if (parsed.recipes.length === 0) {
  console.log("No recipe PHR columns detected.");
  process.exit(0);
}

console.log("Detected recipe PHR columns:");
parsed.recipes.forEach((recipe) => {
  console.log(`${recipe.columnIndex}\t${recipe.name}`);
});
