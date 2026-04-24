// Runtime patch for @alephium/walletconnect-provider@3.0.3.
//
// The upstream provider's connect() method sends a WC session proposal with
// only `optionalNamespaces` and no `requiredNamespaces`. Some wallet clients
// reject with "The proposal does not include a list of required chains".
//
// We override WalletConnectProvider.prototype.connect to include
// `requiredNamespaces` as well. Logs are kept intentionally loud so we can
// confirm the patch applied from the browser devtools console.

import { WalletConnectProvider } from '@alephium/walletconnect-provider'

let patched = false

export function patchWalletConnectProvider(): void {
  if (patched) return
  patched = true
  const proto = WalletConnectProvider.prototype as unknown as {
    session?: { namespaces: unknown }
    client: {
      connect: (args: unknown) => Promise<{
        uri?: string
        approval: () => Promise<{ namespaces: unknown }>
      }>
    }
    permittedChain: string
    methods: string[]
    emitEvents: (name: string, payload: unknown) => void
    updateNamespace: (namespaces: unknown) => void
    cleanMessages: () => Promise<void>
    connect: () => Promise<void>
  }

  // Guard: if @alephium/walletconnect-provider ever fixes this upstream,
  // the prototype may not exist or may already include requiredNamespaces.
  // We log when we apply the patch so the browser console makes the state
  // obvious when something goes wrong.
  // eslint-disable-next-line no-console
  console.log('[openabx] patching WalletConnectProvider.connect — required+optional namespaces')

  proto.connect = async function connect(this: typeof proto): Promise<void> {
    if (!this.session) {
      const namespace = {
        chains: [this.permittedChain],
        methods: this.methods,
        events: ['accountChanged'],
      }
      const proposal = {
        requiredNamespaces: { alephium: namespace },
        optionalNamespaces: { alephium: namespace },
      }
      // eslint-disable-next-line no-console
      console.log('[openabx] sending WC proposal:', JSON.stringify(proposal))
      const { uri, approval } = await this.client.connect(proposal)
      if (uri) this.emitEvents('displayUri', uri)
      this.session = await approval()
    }
    this.updateNamespace(
      (this.session as { namespaces: unknown }).namespaces,
    )
    await this.cleanMessages()
  }
}
