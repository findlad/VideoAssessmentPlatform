import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextVitals,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "functions/lib/**",
      "functions/node_modules/**"
    ]
  }
];

export default eslintConfig;
