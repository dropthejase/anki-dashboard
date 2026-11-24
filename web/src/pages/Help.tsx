import { ArrowDown, ArrowRight, Download, Link2, Monitor, PackageX, RefreshCw, Smartphone, Trash2, Trophy, Unplug, type LucideIcon } from "lucide-react";
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

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
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
    <div className="flex flex-col gap-1.5">
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

export function Help() {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Help</h1>
        <p className="text-muted-foreground">Compete with friends on how many Anki cards you review each day.</p>
      </div>

      <Card>
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
            <Step n={4} title="Sync Anki">
              Press Sync in Anki. This links you to the leaderboard. There is no password to set.
            </Step>
            <Step n={5} title="Open the leaderboard">
              <p>
                In Anki, choose <strong className="text-foreground">Tools → Open Leaderboard</strong>. Your browser opens and signs you in.
              </p>
              <Screenshot src={openLeaderboard} alt="Anki's Tools menu with Open Leaderboard highlighted" width={882} height={684} maxWidth={340} />
            </Step>
            <Step n={6} title="Make or join a board">
              Create a board and share its invite link. Or open a friend&apos;s invite link to join theirs.
            </Step>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Studying on your phone?</CardTitle>
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

      <Card>
        <CardHeader>
          <CardTitle>Common questions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Faq icon={RefreshCw} question="My count looks too low">
            <p>Counts update when Anki on your computer finishes a sync. Sync, then press Refresh on the board.</p>
          </Faq>
          <Faq icon={Link2} question="My sign-in link did not work">
            <p>Links last two minutes and work once. Choose Tools → Open Leaderboard in Anki to get a new one.</p>
          </Faq>
          <Faq icon={Trash2} question="How do I delete my account?">
            <p>Sign in, open the menu with your name at the top right, choose Account, then Delete my account. This removes your name, history and board memberships.</p>
          </Faq>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Something not working?</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Faq icon={PackageX} question="I do not see Open Leaderboard in the Tools menu">
            <p>The add-on is missing or Anki has not restarted since you installed it. Restart Anki first. If it is still missing, reinstall it:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>In Anki, choose <strong className="text-foreground">Tools → Add-ons</strong>, select <strong className="text-foreground">Anki Leaderboard</strong> and click <strong className="text-foreground">Delete</strong>.</li>
              <li>Restart Anki.</li>
              <li>Install the add-on again from the downloaded file (steps 1 and 2 above), and restart Anki once more.</li>
            </ol>
          </Faq>
          <Faq icon={Unplug} question="It says it could not reach the leaderboard">
            <p>
              Check your internet connection, then check that <Code>server_url</Code> in the add-on&apos;s Config matches the address in step 3 above. The message
              names the cause in brackets, such as a certificate problem. If it does, or if the problem started after an update, reinstall the newest add-on
              file as above.
            </p>
          </Faq>
          <Faq icon={RefreshCw} question="It says to sync Anki first">
            <p>
              The leaderboard creates your identity after your first finished sync, so press Sync in Anki (you need to be signed in to AnkiWeb in Anki), then try
              again.
            </p>
          </Faq>
          <Faq icon={Download} question="How do I update the add-on?">
            <p>Download the newest file from the release page and install it the same way as the first time, then restart Anki and check that <Code>server_url</Code> is still set (step 3).</p>
          </Faq>
        </CardContent>
      </Card>
    </>
  );
}
