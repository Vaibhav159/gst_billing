const { test, expect } = require("@playwright/test");
const { SIGNED_OUT, signIn, typesPassword } = require("./session");

typesPassword(test);

test.describe("signed out", () => {
  test.use({ storageState: SIGNED_OUT });

  test("a deep link signs in and lands where it was going", async ({ page }) => {
    await page.goto("/customers");
    await expect(page).toHaveURL(/\/login\?next=%2Fcustomers/);
    await signIn(page);
    await expect(page).toHaveURL(/\/customers$/);
  });
});
