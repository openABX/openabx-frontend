import { expect, test } from '@playwright/test'

test.describe('smoke', () => {
  test('homepage renders, network badge visible, wallet button present', async ({ page }) => {
    await page.goto('/')

    // App title
    await expect(page.getByRole('heading', { name: 'OpenABX', level: 1 })).toBeVisible()

    // Network badge visible (value depends on NEXT_PUBLIC_NETWORK)
    const badge = page.getByTestId('network-badge')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveText(/devnet|testnet|mainnet/i)

    // Wallet connect button must be in the DOM. The exact text comes from
    // @alephium/web3-react and varies slightly across versions; we assert
    // on any button containing 'Connect'.
    const anyConnect = page.locator('button', { hasText: /connect/i })
    await expect(anyConnect.first()).toBeVisible()
  })

  test('page list shows the 5 planned routes', async ({ page }) => {
    await page.goto('/')
    for (const name of ['Dashboard', 'Borrow', 'Stake', 'Auction', 'Vesting']) {
      await expect(page.getByText(name, { exact: true })).toBeVisible()
    }
  })
})
