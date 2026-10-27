import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { Activity, ArrowDown, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronDown, Circle, Compass, FileText, FlaskConical, Layers3, LockKeyhole, Palette, PanelTop, Puzzle, ScanLine, ShieldCheck, SlidersHorizontal, Wallet, Waypoints } from 'lucide-react'
import { BrandMark } from '@/components/layout/Brand'
import { LandingNav } from '@/components/landing/LandingNav'
import { WORKSPACE_TOOLS } from '@/lib/workspaceCatalog'
import styles from './LandingPage.module.css'

export const metadata: Metadata = {
  title: 'OutSol',
  description: 'Design, prepare, rehearse and launch on Pump.fun. Wallet groups, bundles, artwork and token operations in one Solana workspace. 0% OutSol platform fees; network and protocol costs apply.',
}

const featureGroups = [
  { icon: Palette, label: 'MAKE IT YOURS', title: 'A complete design. Ready to return to.', description: 'Build token metadata, create monogram artwork or crop an image, and keep reusable assets in your local library. Save, duplicate and resume drafts. Find a custom mint address with local parallel workers.', links: [{ title: 'Saved drafts', href: '/drafts' }, { title: 'Artwork library', href: '/artwork' }, { title: 'Vanity studio', href: '/vanity' }], visual: 'design' },
  { icon: Wallet, label: 'PREPARE YOUR WALLETS', title: 'A vault with room for your workflow.', description: 'Create or bulk import encrypted wallets, organize them into groups, and review group funding and withdrawals. Inspect balances and account rent, transfer SOL or tokens, and clean up eligible accounts.', links: [{ title: 'Wallets & groups', href: '/wallet' }, { title: 'Inspector', href: '/inspect' }, { title: 'Transfers & cleanup', href: '/wallet-operations?view=manual' }], visual: 'wallet' },
  { icon: SlidersHorizontal, label: 'STAY WITH YOUR TOKEN', title: 'The launch is just the beginning.', description: 'Return to token facts, holdings and notes. Preview native Pump buys and sells, configure bounded trading sessions, discover confirmed launches, and follow receipts or pending operations from Activity.', links: [{ title: 'Token workspaces', href: '/projects' }, { title: 'Buy & sell', href: '/manage' }, { title: 'Trading sessions', href: '/automations' }, { title: 'Discovery', href: '/sniper' }, { title: 'Activity', href: '/activity' }], visual: 'operate' },
] as const

const toolIcons = { Create: Layers3, Prepare: Compass, Operate: SlidersHorizontal }

function ProductPreview() {
  return <figure className={styles.productFigure} aria-label="Illustration of an OutSol launch draft and cost review">
    <div className={styles.previewBackdrop} aria-hidden="true"><span /><span /><span /></div>
    <div className={styles.productWindow}>
      <div className={styles.windowTop}><span className={styles.windowBrand}><BrandMark />Launch workspace</span><span className={styles.exampleBadge}>PRODUCT PREVIEW</span></div>
      <div className={styles.windowBody}>
        <div className={styles.previewRail} aria-hidden="true"><span><Palette size={17} />Design<Check size={12} /></span><span><Wallet size={17} />Prepare<Check size={12} /></span><span className={styles.previewRailActive}><ScanLine size={17} />Review<Circle size={8} /></span><span><ArrowUpRight size={17} />Launch</span><div /><LockKeyhole size={17} /></div>
        <div className={styles.previewMain}>
          <div className={styles.previewBreadcrumb}>Your next launch <span>/</span> Review</div>
          <div className={styles.previewHeading}><h2>Bring it all together.</h2><span>Draft</span></div>
          <div className={styles.tokenPreview}>
            <div className={styles.orbitArtwork} aria-hidden="true"><span /><span /><i /></div>
            <div><p>Orbit</p><span>$ORBIT · Example design</span><small>A little idea. A world of possibility.</small></div>
          </div>
          <div className={styles.previewFields}><div><span>Launchpad</span><b>Pump.fun<ArrowUpRight size={11} /></b></div><div><span>Execution</span><b>Your choice</b></div></div>
          <div className={styles.previewChecklist}><span><CheckCheck size={15} />Metadata & artwork</span><span><CheckCheck size={15} />Wallet selection</span><span><ScanLine size={15} />Costs before signing</span></div>
          <div className={styles.previewButton}>Review your launch<ArrowRight size={15} /></div>
        </div>
      </div>
      <div className={styles.windowBottom}><span><ShieldCheck size={13} />Review before you sign</span><span>Built for Solana</span></div>
    </div>
    <div className={styles.costCard}><div className={styles.costCardHeading}><span><ScanLine size={15} />Cost review</span><span>EXAMPLE</span></div><dl><div><dt>OutSol platform fee</dt><dd>0 SOL</dd></div><div><dt>Network & account rent</dt><dd>Shown at review</dd></div><div><dt>Protocol costs & tips</dt><dd>Disclosed separately</dd></div></dl><div className={styles.costCardNote}><Check size={12} />Your review. Your approval.</div></div>
    <figcaption>Illustrative draft · no balances or live transactions shown</figcaption>
  </figure>
}

function FeatureVisual({ kind }: { kind: 'design' | 'wallet' | 'operate' }) {
  if (kind === 'design') return <div className={styles.designVisual} aria-hidden="true"><div className={styles.artworkTile}><span>O</span></div><div className={styles.artworkTile}><span>O</span></div><div className={styles.artworkTile}><span>O</span></div><div className={styles.designVisualLabel}><Palette size={13} /><span>One idea. Your expression.</span></div></div>
  if (kind === 'wallet') return <div className={styles.walletVisual} aria-hidden="true"><div><span><LockKeyhole size={15} />Wallet vault</span><small>ENCRYPTED</small></div><span><span className={styles.walletAvatar}>01</span><span>Creator wallet<small>Launch group</small></span><Check size={14} /></span><span><span className={styles.walletAvatar}>02</span><span>Participant wallet<small>Launch group</small></span><Check size={14} /></span><span className={styles.walletVisualFooter}><Wallet size={13} />Create · Import · Organize</span></div>
  return <div className={styles.operateVisual} aria-hidden="true"><div><Activity size={15} /><span>Every step, in view.</span></div><span><i /><span>Launch review<small>Check the details</small></span><ScanLine size={16} /></span><span><i /><span>Transaction receipt<small>Follow confirmation</small></span><FileText size={16} /></span><span><i /><span>Token workspace<small>Return to your project</small></span><PanelTop size={16} /></span></div>
}

function XLogo() {
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.2-8.3L.8 2h6.5l4.5 6.8L18.9 2Zm-1.1 18h1.7L6.4 3.9H4.6L17.8 20Z" /></svg>
}

function GithubLogo() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.76-.24.76-.54v-2.1c-3.12.68-3.78-1.32-3.78-1.32-.5-1.3-1.25-1.64-1.25-1.64-1.02-.69.08-.68.08-.68 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.54 0-1.22.44-2.22 1.15-3-.11-.29-.5-1.42.11-2.96 0 0 .94-.3 3.08 1.15a10.7 10.7 0 0 1 5.6 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.54.23 2.67.11 2.95.72.8 1.15 1.8 1.15 3.01 0 4.3-2.63 5.25-5.15 5.53.4.35.76 1.03.76 2.08v3.18c0 .3.2.65.77.54A11.2 11.2 0 0 0 12 .8Z" /></svg>
}

export default function HomePage() {
  return <div className={styles.landing}>
    <a className={styles.skipLink} href="#main-content">Skip to content</a>
    <LandingNav />
    <main id="main-content" tabIndex={-1}>
      <section className={`${styles.hero} ${styles.container}`} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <Link href="#pricing" className={styles.heroBadge}><span />0% OutSol platform fees. Always.<ArrowUpRight size={13} aria-hidden="true" /></Link>
          <h1 id="hero-title">Your next launch.<br /><span>All in one place.</span><br />0% OutSol fees.</h1>
          <p className={styles.heroDescription}>From the first draft to what comes after. Design, prepare and launch on Pump.fun with everything in one considered workspace.</p>
          <div className={styles.heroActions}><Link className={styles.primaryButton} href="/launches">Open workspace<ArrowUpRight size={17} /></Link><Link className={styles.secondaryButton} href="#features">Discover OutSol<ArrowDown size={15} /></Link></div>
          <p className={styles.heroFootnote}>Free to use. Network fees, account rent and protocol costs apply.</p>
        </div>
        <ProductPreview />
      </section>

      <div className={styles.contextStrip}><div className={styles.container}><span>A focused workspace for Solana.</span><span><Waypoints size={18} />Native Pump.fun launches</span><span><LockKeyhole size={17} />Local wallet signing</span><span><ScanLine size={17} />Review before execution</span></div></div>

      <section id="about" className={`${styles.about} ${styles.container}`} aria-labelledby="about-title">
        <div><span className={styles.eyebrow}>A LITTLE MORE CLARITY</span><h2 id="about-title">Less friction.<br /><span>More intention.</span></h2></div>
        <div className={styles.aboutCopy}><p>OutSol brings the pieces of a token launch into one place: your design, your wallets, your execution plan and the operations that follow.</p><p>Start with an idea. Work through the details. See what you’re signing. Come back to a workspace that keeps the context.</p><Link href="/launches" className={styles.textLink}>Meet your workspace<ArrowRight size={16} /></Link></div>
      </section>

      <section id="workflow" className={`${styles.workflowSection} ${styles.container}`} aria-labelledby="workflow-title">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>FROM IDEA TO ONCHAIN</span><h2 id="workflow-title">A clear path through the details.</h2></div><p>Four steps. One continuous workspace.</p></div>
        <div className={styles.workflowGrid}>
          {[
            { n: '01', icon: Palette, title: 'Design', text: 'Give your token a name, a story and a visual identity. Save the draft and make it yours.', href: '/launch?new=1', action: 'Start a design' },
            { n: '02', icon: Wallet, title: 'Prepare', text: 'Choose your mint, organize wallets and select an execution plan that fits your launch.', href: '/planner', action: 'Make a plan' },
            { n: '03', icon: ScanLine, title: 'Review', text: 'Check amounts, costs and transaction details. Rehearse with simulated SOL before committing funds.', href: '/rehearse', action: 'Try a rehearsal' },
            { n: '04', icon: ArrowUpRight, title: 'Launch', text: 'Approve your native Pump.fun launch. Follow the receipt and return to your token workspace.', href: '/launch?mode=standard&venue=pump', action: 'Create a token' },
          ].map(step => <article className={styles.workflowStep} key={step.n}><div className={styles.workflowStepTop}><span>{step.n}</span><step.icon size={22} strokeWidth={1.3} /></div><h3>{step.title}</h3><p>{step.text}</p><Link href={step.href}>{step.action}<ArrowUpRight size={14} /></Link></article>)}
        </div>
      </section>

      <section id="features" className={styles.featuresSection} aria-labelledby="features-title">
        <div className={styles.container}>
          <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>THE WHOLE WORKFLOW</span><h2 id="features-title">Everything has its place.</h2></div><p>Thoughtful tools for each part of your launch.</p></div>
          <article className={styles.bundleFeature}>
            <div className={styles.bundleCopy}><span className={styles.featureIcon}><Layers3 size={21} strokeWidth={1.4} /></span><span className={styles.eyebrow}>INTEGRATED WALLET BUNDLES</span><h3>Your launch.<br />Your execution plan.</h3><p>Keep your token, creator wallet and participant wallets together. Choose how buys are coordinated and where creator fees go: your deployer, another wallet, an individual GitHub account or holder rewards. Review every route before you sign.</p><Link className={styles.textLink} href="/launch?new=1">Configure your launch<ArrowUpRight size={16} /></Link></div>
            <div className={styles.bundleDiagram}>
              <div className={styles.bundleDiagramTitle}><span><BrandMark />A plan, before a transaction.</span><span>PUMP.FUN</span></div>
              <div className={styles.bundleMode}><span className={styles.modeSymbol}><Layers3 size={17} /></span><div><h4>Atomic / Block 0</h4><p>Coordinate creation and compatible buys in an atomic bundle.</p></div><span className={styles.modeTag}>TOGETHER</span></div>
              <div className={styles.bundleMode}><span className={styles.modeSymbol}><Waypoints size={17} /></span><div><h4>Organic</h4><p>Spread selected wallet buys across your configured intervals.</p></div><span className={styles.modeTag}>INTERVALS</span></div>
              <div className={styles.bundleMode}><span className={styles.modeSymbol}><SlidersHorizontal size={17} /></span><div><h4>Manual / after confirmation</h4><p>Review wallet operations and buys after the launch confirms.</p></div><span className={styles.modeTag}>IN CONTROL</span></div>
              <p className={styles.bundleDisclosure}>Execution depends on network conditions and transaction compatibility. “Block 0” is a route name, not a guarantee of first-block inclusion or protection from other traders.</p>
            </div>
          </article>
          <div className={styles.featureGrid}>{featureGroups.map(feature => <article key={feature.title} className={styles.featureCard}>
            <FeatureVisual kind={feature.visual} />
            <div className={styles.featureCardBody}><span className={styles.eyebrow}><feature.icon size={14} />{feature.label}</span><h3>{feature.title}</h3><p>{feature.description}</p><div className={styles.featureLinks}>{feature.links.map(link => <Link key={link.href} href={link.href}>{link.title}<ArrowUpRight size={12} /></Link>)}</div></div>
          </article>)}</div>

          <div className={styles.companionGrid}>
            <article className={styles.companionCard}><div className={styles.companionIcon}><FlaskConical size={24} strokeWidth={1.4} /></div><div><span className={styles.eyebrow}>PRACTICE THE WHOLE FLOW</span><h3>Confidence starts with a rehearsal.</h3><p>Run Pump.fun creation with simulated SOL and inspect the result. Use the planner to review a budget, or prepare two to five fresh tokens in Multi-launch with a separate cost review for each.</p><div className={styles.featureLinks}><Link href="/rehearse">Launch rehearsal<ArrowUpRight size={12} /></Link><Link href="/planner">Launch planner<ArrowUpRight size={12} /></Link><Link href="/multi-launch">Multi-launch<ArrowUpRight size={12} /></Link></div></div></article>
            <article className={styles.companionCard}><div className={styles.companionIcon}><Puzzle size={24} strokeWidth={1.4} /></div><div><span className={styles.eyebrow}>CAPTURE THE SPARK</span><h3>From a reference to a reviewed draft.</h3><p>Capture a page, selection or image with the browser extension. Import a public X post into a fresh draft, then review and edit it before launching. Share a confirmed launch through X’s own announcement composer.</p><div className={styles.featureLinks}><Link href="/extension">Browser extension<ArrowUpRight size={12} /></Link><Link href="/x">Launch from X<ArrowUpRight size={12} /></Link></div><p className={styles.setupNote}>X account connection requires operator setup. <span>Live X monitoring is coming soon.</span></p></div></article>
          </div>
        </div>
      </section>

      <section id="pricing" className={styles.pricingSection} aria-labelledby="pricing-title"><div className={`${styles.container} ${styles.pricingInner}`}>
        <div className={styles.pricingIntro}><span className={styles.eyebrow}>SIMPLE BY DESIGN</span><h2 id="pricing-title">Your launch budget.<br /><span>For your launch.</span></h2><p>The entire OutSol workspace is free to use. No subscription. No OutSol platform fee added to your launches or trades.</p><Link className={styles.darkButton} href="/launches">Start with OutSol<ArrowUpRight size={17} /></Link></div>
        <div className={styles.pricePanel}><div className={styles.priceFigure}>0<span>%</span></div><h3>OutSol platform fees. Forever.</h3><div className={styles.priceDivider} /><ul><li><Check size={15} />All workspace tools included</li><li><Check size={15} />No OutSol launch or trade surcharge</li><li><Check size={15} />Costs reviewed before you sign</li></ul><p>Onchain actions still require SOL. Solana network fees, account rent, Pump.fun protocol or creator fees, and any disclosed validator tips or third-party costs apply. These are separate from OutSol’s zero platform fee.</p></div>
      </div></section>

      <section id="tools" className={`${styles.toolkitSection} ${styles.container}`} aria-labelledby="toolkit-title">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>FIND YOUR NEXT STEP</span><h2 id="toolkit-title">A toolkit that works together.</h2></div><Link href="/launches" className={styles.textLink}>Open your workspace<ArrowUpRight size={16} /></Link></div>
        <div className={styles.toolkitGrid}>{(['Create', 'Prepare', 'Operate'] as const).map(category => {
          const Icon = toolIcons[category]
          return <div key={category} className={styles.toolkitColumn}><h3><Icon size={18} strokeWidth={1.4} />{category}</h3>{WORKSPACE_TOOLS.filter(tool => tool.category === category).map(tool => <Link key={tool.id} href={tool.href} className={styles.toolkitLink}><span><b>{tool.title}{tool.status === 'coming-soon' && <small>Coming soon</small>}</b><span>{tool.description}</span></span><ArrowUpRight size={15} /></Link>)}</div>
        })}</div>
      </section>

      <section className={`${styles.faqSection} ${styles.container}`} aria-labelledby="faq-title"><div><span className={styles.eyebrow}>A FEW THINGS, CLEARLY</span><h2 id="faq-title">Before you begin.</h2><p>Know the tools.<br />Understand the costs.<br />Keep the final say.</p></div><div className={styles.faqList}>
        {[
          { q: 'Is OutSol really free?', a: 'Yes. OutSol charges 0% platform fees and has no subscription. Onchain actions still have costs: Solana network fees, account rent, Pump.fun protocol or creator fees, and any validator tips or third-party costs shown in your review.' },
          { q: 'Where does OutSol launch tokens?', a: 'OutSol’s launch workflow creates native Pump.fun tokens on Solana. You can prepare a single launch or use Multi-launch to review two to five fresh tokens. Each launch has its own transaction and cost review.' },
          { q: 'What does Atomic / Block 0 mean?', a: 'It is an execution option that coordinates token creation with compatible immediate buys in an atomic bundle. It does not guarantee first-block placement, a specific purchase order against other traders, or protection from snipers. Review the wallets, budgets, tips and current limits in the workspace.' },
          { q: 'How should I handle wallets and saved work?', a: 'Managed wallets are encrypted, and signing happens in your browser. Export and securely store wallet backups before funding them. Drafts and artwork are stored on this device, so clearing browser data can remove them. Keep any files and key backups you need.' },
          { q: 'Can I launch from an X post?', a: 'You can import a public X post, review the resulting draft and choose what to use before launching. The browser extension can also capture page, selection and image references. Connecting an X account requires operator setup; live account monitoring and post alerts are coming soon.' },
          { q: 'Can I try the launch flow first?', a: 'Yes. Launch rehearsal executes Pump.fun creation with simulated SOL so you can inspect the result before a mainnet launch. A rehearsal does not guarantee a later mainnet outcome; network conditions and costs can change.' },
        ].map(item => <details key={item.q} className={styles.faqItem}><summary>{item.q}<ChevronDown size={17} aria-hidden="true" /></summary><p>{item.a}</p></details>)}
      </div></section>

      <section className={`${styles.finalCta} ${styles.container}`} aria-labelledby="cta-title"><BrandMark className={styles.finalSymbol} /><span className={styles.eyebrow}>MAKE ROOM FOR YOUR NEXT IDEA</span><h2 id="cta-title">From first thought.<br /><span>To your next launch.</span></h2><p>Your tools are here. Your next move is yours.</p><Link className={styles.primaryButton} href="/launches">Open workspace<ArrowUpRight size={17} /></Link><span className={styles.finalFee}>0% OutSol platform fees · Network and protocol costs apply</span></section>
    </main>
    <footer className={styles.footer}><div className={`${styles.container} ${styles.footerTop}`}><div><Link href="/" aria-label="OutSol home"><Image src="/brand/outsol-lockup-mint.svg" width={122} height={33} alt="OutSol" /></Link><p>A considered workspace.<br />For what you create next.</p></div><nav aria-label="Footer navigation"><Link href="/launches">Launches</Link><Link href="#features">Features</Link><Link href="#tools">Tools</Link><Link href="#pricing">Pricing</Link></nav><div className={styles.socialLinks}><a href="https://github.com/OutsolOnline" target="_blank" rel="noopener noreferrer" aria-label="OutSol on GitHub (opens in new tab)"><GithubLogo />GitHub<ArrowUpRight size={13} /></a><a href="https://x.com/OutSolOnline" target="_blank" rel="noopener noreferrer" aria-label="OutSol on X (opens in new tab)"><XLogo />Follow on X<ArrowUpRight size={13} /></a></div></div><div className={`${styles.container} ${styles.footerBottom}`}><span>© {new Date().getFullYear()} OutSol</span><span>Built for Solana. Built around your workflow.</span><span>0% OutSol platform fees.</span></div></footer>
  </div>
}
