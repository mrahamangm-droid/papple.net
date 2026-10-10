import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    // platform/ is linted by its own config in the platform CI job.
    ignores: [".next/**", "node_modules/**", "platform/**"],
  },
];

export default eslintConfig;
