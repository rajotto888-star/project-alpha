export class CanaryLogger {
  private static forbidden = ["sk-", "Bearer ", "api_key", "apiKey", "password", "passphrase"];

  static assertNoCanary(haystack: string): void {
    for (const token of CanaryLogger.forbidden) {
      if (haystack.includes(token)) {
        throw new Error(`CanaryLogger: forbidden token "${token}" found in persisted/logged data`);
      }
    }
  }
}
