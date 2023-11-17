/**
 * function graphqlImpl(args: GraphQLArgs): PromiseOrValue<ExecutionResult> {
 *   // Temporary for v15 to v16 migration. Remove in v17
 *   devAssert(
 *     arguments.length < 2,
 *     'graphql@16 dropped long-deprecated support for positional arguments, please pass an object instead.',
 *   );
 *
 *   const {
 *     schema,
 *     source,
 *     rootValue,
 *     contextValue,
 *     variableValues,
 *     operationName,
 *     fieldResolver,
 *     typeResolver,
 *   } = args;
 *
 *   // Validate Schema
 *   const schemaValidationErrors = validateSchema(schema);
 *   if (schemaValidationErrors.length > 0) {
 *     return { errors: schemaValidationErrors };
 *   }
 *
 *   // Parse
 *   let document;
 *   try {
 *     document = parse(source);
 *   } catch (syntaxError) {
 *     return { errors: [syntaxError] };
 *   }
 *
 *   // Validate
 *   const validationErrors = validate(schema, document);
 *   if (validationErrors.length > 0) {
 *     return { errors: validationErrors };
 *   }
 *
 *   // Execute
 *   return execute({
 *     schema,
 *     document, // документ, который получился в результате парсинга стринги с дефиницией нашей операции
 *     rootValue,
 *     contextValue,
 *     variableValues,
 *     operationName,
 *     fieldResolver,
 *     typeResolver,
 *   });
 * }
 */
