import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Brand } from "../../shared/ui/Brand";
import { Icon } from "../../shared/ui/Icon";
import { Appearance } from "../../shared/ui/Appearance";

import { useSession } from "../../shared/auth/session";

export function SignIn() {
  const session = useSession();
  return (
    <main className="signin">
      <section className="signin-story">
        <a className="brand-link" href="/" aria-label="Riflo home">
          <Brand />
        </a>
        <div className="story-content">
          <p className="eyebrow">GOOD IDEAS DESERVE AN ENCORE</p>
          <h1>
            One recording.
            <br />
            More to say<span className="editorial-text">.</span>
          </h1>
          <p className="story-description">
            Turn the things you’ve already said into the things you’ll share
            next.
          </p>
          <div
            className="idea-stack"
            aria-label="Illustration: a recording becomes posts, stories and videos"
          >
            <div className="stack-card stack-back">
              <span>THE NEXT CHAPTER</span>
              <strong>
                A story worth
                <br />
                passing on.
              </strong>
              <span className="sample-label">Illustrative content</span>
            </div>
            <div className="stack-card stack-front">
              <div className="waveform" aria-hidden="true">
                {[
                  22, 38, 58, 32, 70, 90, 52, 35, 66, 40, 24, 50, 78, 43, 62,
                  30, 50, 20,
                ].map((height, i) => (
                  <i key={i} style={{ height }} />
                ))}
              </div>
              <div className="recording-label">
                <span className="play-disc">
                  <Icon name="play" size={15} />
                </span>
                <span>Your original recording</span>
                <ChevronRight size={16} aria-hidden="true" />
              </div>
            </div>
            <span className="stack-note">One idea. Many possibilities.</span>
          </div>
        </div>
        <span className="story-footer">
          Less starting over. More making things.
        </span>
      </section>
      <section className="signin-form">
        <Appearance />
        <div className="signin-inner">
          <span className="small-flower" aria-hidden="true">
            ✳
          </span>
          <p className="eyebrow">YOUR CREATIVE WORKSPACE</p>
          <h2>
            Make room for
            <br />
            what’s next.
          </h2>
          <p>Bring your video. We’ll help your ideas find their next form.</p>
          <Button
            variant="outline"
            className="google-button mt-8 w-full"
            type="button"
            aria-busy={session.busy}
            aria-describedby="signin-status"
            onClick={session.login}
            disabled={!session.configured || session.busy}
          >
            <span className="google-letter" aria-hidden="true">
              G
            </span>{" "}
            {session.busy ? "Opening Google…" : "Continue with Google"}
          </Button>
          <p id="signin-status" className={session.error ? "setup-note state-error" : "setup-note"} role={session.error ? "alert" : "status"}>
            {session.error ||
              "Signing in opens your private studio. Drive permission is requested separately."}
          </p>
          <Button asChild className="w-full">
            <a href="/projects?preview=true">
              Explore the preview <ChevronRight size={16} aria-hidden="true" />
            </a>
          </Button>
          <p className="quiet-note">
            Preview uses sample content. No account or video is needed.
          </p>
          <div className="privacy-note">
            <Icon name="link" size={16} />
            <span>
              You choose which Drive videos to share.
              <br />
              Signing in won’t connect your Drive.
            </span>
          </div>
        </div>
        <span className="signin-bottom">
          Made for ideas with somewhere to go.
        </span>
      </section>
    </main>
  );
}
