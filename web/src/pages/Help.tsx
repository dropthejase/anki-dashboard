import { ArrowDown, ArrowRight, Download, Monitor, KeyRound, Laptop, PackageX, RefreshCw, Smartphone, Trash2, Trophy, Unplug, type LucideIcon } from "lucide-react";
import { Fragment } from "react";
import addonConfig from "../assets/help/anki-addon-config.png";
import addonMenu from "../assets/help/anki-addon-menu.png";
import openLeaderboard from "../assets/help/anki-open-leaderboard.png";
import toolsAddons from "../assets/help/anki-tools-addons.png";
import releaseAssets from "../assets/help/release-assets.png";
import { buttonVariants } from "../components/ui/button";
import { Code } from "../components/Code";
import { CopyField } from "../components/CopyField";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { ADDON_DOWNLOAD_URL, INSTALL_GUIDE_URL } from "../lib/links";

const Q = {
  low: "My count looks too low",
  message: "Open Leaderboard shows a message instead of opening",
  missing: "I do not see Open Leaderboard in the Tools menu",
  update: "How do I update the add-on?",
  menu: "What do the Tools menu items do?",
  computers: "Can I use more than one computer?",
  recovery: "What is a recovery code, and how do I use one?",
  delete: "How do I delete my account?",
} as const;

const PHONE_TITLE = "Studying on your phone?";

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li id={`step-${n}`} className="flex scroll-mt-20 gap-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden>
        {n}
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">{title}</h3>
        <div className="space-y-3 text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

function Screenshot({ src, alt, width, height, maxWidth }: { src: string; alt: string; width: number; height: number; maxWidth: number }) {
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      style={{ maxWidth }}
      className="h-auto w-full rounded-lg border border-border"
    />
  );
}

function Faq({ icon: Icon, question, children }: { icon: LucideIcon; question: string; children: React.ReactNode }) {
  return (
    <div id={slug(question)} className="flex scroll-mt-20 flex-col gap-1.5">
      <h3 className="flex items-center gap-2 font-medium">
        <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden /> {question}
      </h3>
      <div className="space-y-2 text-muted-foreground">{children}</div>
    </div>
  );
}

function Flow({ nodes, label }: { nodes: { icon: LucideIcon; text: string }[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col items-center gap-2 rounded-xl border border-border bg-muted p-4 sm:flex-row sm:justify-between">
      {nodes.map((n, i) => (
        <Fragment key={n.text}>
          <li className="flex w-full flex-row items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 sm:w-auto sm:flex-col sm:justify-center sm:gap-1 sm:px-4 sm:py-3">
            <n.icon className="h-6 w-6 text-accent" aria-hidden />
            <span className="text-center text-sm font-medium">{n.text}</span>
          </li>
          {i < nodes.length - 1 && (
            <>
              <ArrowDown className="h-4 w-4 text-muted-foreground sm:hidden" aria-hidden />
              <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
            </>
          )}
        </Fragment>
      ))}
    </ol>
  );
}

function Contents() {
  const link = "block rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-background hover:text-foreground";
  const heading = "block rounded-md px-2 py-1 text-sm font-semibold hover:bg-background";
  return (
    <nav aria-label="On this page" className="xl:absolute xl:right-full xl:top-0 xl:mr-6 xl:h-full xl:w-52">
      <div className="max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-border bg-muted p-3 xl:sticky xl:top-20">
        <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">On this page</p>
        <ul className="flex flex-col gap-0.5">
          <li>
            <a href="#get-started" className={heading}>Get started</a>
          </li>
          <li>
            <a href="#phone" className={heading}>{PHONE_TITLE}</a>
          </li>
          <li>
            <a href="#common-questions" className={heading}>Common questions</a>
            <ul className="ml-2 border-l border-border pl-1">
              {Object.values(Q).map((q) => (
                <li key={q}>
                  <a href={`#${slug(q)}`} className={link}>{q}</a>
                </li>
              ))}
            </ul>
          </li>
        </ul>
      </div>
    </nav>
  );
}

export function Help() {
  return (
    <div className="relative flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Help</h1>
        <p className="text-muted-foreground">Compete with friends on how many Anki cards you review each day.</p>
      </div>

      <Contents />

      <Card id="get-started" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>Get started</CardTitle>
          <a
            href={INSTALL_GUIDE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Running your own server? See the install guide
          </a>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-5">
            <Step n={1} title="Download the add-on">
              <p>
                Open the latest release and, under <strong className="text-foreground">Assets</strong>, click{" "}
                <Code>anki_leaderboard.ankiaddon</Code> to save it.
              </p>
              <a href={ADDON_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className={buttonVariants()}>
                <Download className="h-4 w-4" aria-hidden /> Download the add-on
              </a>
              <Screenshot src={releaseAssets} alt="The release page, with anki_leaderboard.ankiaddon listed under Assets" width={648} height={206} maxWidth={324} />
            </Step>
            <Step n={2} title="Install the add-on">
              <p>
                In Anki on your computer, choose <strong className="text-foreground">Tools → Add-ons</strong>, then{" "}
                <strong className="text-foreground">Install from file…</strong>, and pick the file you downloaded.
              </p>
              <Screenshot src={toolsAddons} alt="Anki's Tools menu with Add-ons highlighted" width={884} height={678} maxWidth={340} />
              <p className="rounded-lg border border-border bg-muted px-3 py-2 text-foreground">
                <strong>Then restart Anki.</strong> The add-on does not load until you do, and the new menu items will not appear. Anki reminds you with
                &ldquo;Changes will take effect when Anki is restarted&rdquo;.
              </p>
            </Step>
            <Step n={3} title="Point the add-on at this site">
              <p>
                Back in <strong className="text-foreground">Tools → Add-ons</strong>, select <strong className="text-foreground">Anki Leaderboard</strong>,
                then click <strong className="text-foreground">Config</strong>.
              </p>
              <Screenshot src={addonMenu} alt="The Add-ons window with Anki Leaderboard selected and the Config button on the right" width={978} height={700} maxWidth={420} />
              <p>
                Set <Code>server_url</Code> to this address if it is not already, and click OK:
              </p>
              <CopyField label="Server address" value={location.origin} />
              <Screenshot src={addonConfig} alt="The add-on's Config window with the server_url value highlighted" width={1092} height={448} maxWidth={600} />
            </Step>
            <Step n={4} title="Open the leaderboard">
              <p>
                In Anki, choose <strong className="text-foreground">Tools → Open Leaderboard</strong>. The first time, it asks &ldquo;Do you already have a leaderboard account?&rdquo;. Choose{" "}
                <strong className="text-foreground">No, create one</strong>. Your browser then opens and signs you in. There is no password to set.
              </p>
              <Screenshot src={openLeaderboard} alt="Anki's Tools menu showing Open Leaderboard, Update My Count Now and Leaderboard Settings" width={552} height={412} maxWidth={340} />
            </Step>
            <Step n={5} title="Make or join a board">
              Create a board and share its invite link. Or open a friend&apos;s invite link to join theirs. Your count updates each time Anki finishes a sync.
            </Step>
            <Step n={6} title="Add another computer (optional)">
              <p>
                On a computer that is already set up, choose <strong className="text-foreground">Tools → Leaderboard Settings → Show a code for my other computer</strong> and note the code. On the new
                computer, install the add-on (steps 1 to 3), choose <strong className="text-foreground">Tools → Open Leaderboard</strong>, answer{" "}
                <strong className="text-foreground">Yes, enter the code from my other computer</strong> and type the code. It works once and expires after 10 minutes.
              </p>
            </Step>
          </ol>
        </CardContent>
      </Card>

      <Card id="phone" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>{PHONE_TITLE}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p>
            Your phone cannot send reviews to the leaderboard. Only Anki on your computer can. Your phone reviews still count, but only if you sync in this
            order on the same day:
          </p>
          <Flow
            label="How phone reviews reach the leaderboard"
            nodes={[
              { icon: Smartphone, text: "Sync your phone" },
              { icon: Monitor, text: "Sync Anki on your computer" },
              { icon: Trophy, text: "Leaderboard updates" },
            ]}
          />
          <p className="text-muted-foreground">
            Signing in also needs Anki on your computer, so you cannot sign in from a phone on its own.
          </p>
        </CardContent>
      </Card>

      <Card id="common-questions" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>Common questions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Faq icon={RefreshCw} question={Q.low}>
            <p>Counts update when Anki on your computer finishes a sync. Sync, then press Refresh on the board.</p>
          </Faq>
          <Faq icon={Unplug} question={Q.message}>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong className="text-foreground">&ldquo;This computer was removed from your leaderboard account&rdquo;:</strong> someone removed it on the Account page.
                Choose Tools → Open Leaderboard again and add it back with a code from your other computer, or restore with your recovery code.
              </li>
              <li>
                <strong className="text-foreground">&ldquo;Could not reach the leaderboard&rdquo;:</strong> check your internet connection, then check that{" "}
                <Code>server_url</Code> in the add-on&apos;s Config matches the address in step 3. The message names the cause in brackets. If it says a certificate
                problem, or the trouble began after an update, reinstall the newest add-on file.
              </li>
              <li>
                <strong className="text-foreground">The sign-in page says the link expired:</strong> links last two minutes and work once. Choose Tools → Open Leaderboard
                again for a new one.
              </li>
            </ul>
          </Faq>
          <Faq icon={PackageX} question={Q.missing}>
            <p>The add-on is missing, or Anki has not restarted since you installed it. Restart Anki first. If it is still missing, reinstall it:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>In Anki, choose <strong className="text-foreground">Tools → Add-ons</strong>, select <strong className="text-foreground">Anki Leaderboard</strong> and click <strong className="text-foreground">Delete</strong>.</li>
              <li>Restart Anki.</li>
              <li>Install the add-on again from the downloaded file (steps 1 and 2 above), and restart Anki once more.</li>
            </ol>
          </Faq>
          <Faq icon={Download} question={Q.update}>
            <p>
              Download the newest file from the release page and install it the same way as the first time, then restart Anki and check that <Code>server_url</Code> is
              still set (step 3).
            </p>
          </Faq>
          <Faq icon={Monitor} question={Q.menu}>
            <p>
              <strong className="text-foreground">Open Leaderboard</strong> opens this site and signs you in. <strong className="text-foreground">Update My Count Now</strong>{" "}
              sends today&apos;s count straight away instead of waiting for your next sync (one update every 30 minutes at most).{" "}
              <strong className="text-foreground">Leaderboard Settings…</strong> holds the rare actions: show or enter a code to add a computer, restore with a recovery
              code, and reset this computer&apos;s key.
            </p>
          </Faq>
          <Faq icon={Laptop} question={Q.computers}>
            <p>
              Yes, up to ten. Each computer has its own key, and they all belong to one account. Add one with step 6 above. You can see your computers, and remove
              one that is lost or sold, on your Account page.
            </p>
            <p>
              The limit is one account per computer, not per Anki profile. If you use several Anki profiles on one computer, they share one leaderboard account and the
              highest count of the day is kept.
            </p>
          </Faq>
          <Faq icon={KeyRound} question={Q.recovery}>
            <p>
              It is a backup key for your account. If you lose every computer that was on your account, for example after a wipe or a new machine, it restores your
              account with its boards and roles. Make one now from the menu with your name, then <strong className="text-foreground">Account → Create recovery code</strong>,
              and keep it somewhere safe.
            </p>
            <p>
              To use it, choose <strong className="text-foreground">Tools → Leaderboard Settings → Restore with a recovery code</strong> in Anki and paste the code. It works once, and you are given a
              new one to save. It signs out your other computers, so link them again afterwards. Without a saved code, a lost account cannot be recovered: you start a
              new one, and a board admin can invite you back.
            </p>
          </Faq>
          <Faq icon={Trash2} question={Q.delete}>
            <p>Sign in, open the menu with your name at the top right, choose Account, then Delete my account. This removes your name, history and board memberships.</p>
          </Faq>
        </CardContent>
      </Card>
    </div>
  );
}
