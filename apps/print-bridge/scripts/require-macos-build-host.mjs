if (process.platform !== "darwin") {
  throw new Error(
    "Dixora Print Bridge .dmg paketi yalnızca macOS üzerinde veya macOS GitHub Actions çalıştırıcısında üretilebilir.",
  );
}
