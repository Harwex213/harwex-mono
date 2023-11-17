import { invalidSchema, validSchema } from "./parse-stage";
import { validateSchema } from "graphql";

let schemaValidationErrors = validateSchema(invalidSchema);

console.log(schemaValidationErrors);

schemaValidationErrors = validateSchema(validSchema);

console.log(schemaValidationErrors);

const validatedSchema = validSchema;

export { validatedSchema };
