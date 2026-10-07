'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import styles from './labs.module.css';
import type { NetworkSnapshot } from './network';

function Hive({ minds }: { minds: number | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let visible = false;
    let width = 0;
    let height = 0;
    let elapsed = 0;
    let previousTime = 0;
    let dirty = true;
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    // Positions and signals are illustrative; node count follows the verified community.
    const count = minds === null ? 0 : Math.min(minds, 2000);
    const points = Array.from({ length: count }, (_, i) => {
      const y = 1 - (i / Math.max(1, count - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const theta = i * Math.PI * (3 - Math.sqrt(5));
      return { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius };
    });
    // Calculate real neighbours once, rather than searching the mesh every frame.
    const edges: [number, number][] = [];
    points.forEach((p, i) => {
      for (let j = i + 1; j < points.length; j++) {
        const q = points[j];
        if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2 < 20 / Math.max(1, count)) edges.push([i, j]);
      }
    });
    const projected = points.map(() => ({ x: 0, y: 0, z: 0 }));
    const draw = (time: number) => {
      frame = 0;
      if (!visible || document.hidden || !width) {
        previousTime = 0;
        return;
      }
      if (previousTime) elapsed += Math.min(time - previousTime, 48);
      previousTime = time;
      if (!reduced.matches || dirty) {
        dirty = false;
        ctx.clearRect(0, 0, width, height);
        pointer.x += (pointer.targetX - pointer.x) * 0.045;
        pointer.y += (pointer.targetY - pointer.y) * 0.045;
        const angle = reduced.matches ? 0.4 : elapsed * 0.000045 + pointer.x;
        const tilt = reduced.matches ? 0.22 : 0.22 + pointer.y;
        const r = Math.min(width, height) * 0.365 * (reduced.matches ? 1 : 1 + Math.sin(elapsed * 0.00035) * 0.018);
        const cos = Math.cos(angle),
          sin = Math.sin(angle),
          cosTilt = Math.cos(tilt),
          sinTilt = Math.sin(tilt);
        points.forEach((p, i) => {
          const x = p.x * cos + p.z * sin;
          const z = -p.x * sin + p.z * cos;
          projected[i].x = width / 2 + x * r;
          projected[i].y = height / 2 + (p.y * cosTilt - z * sinTilt) * r;
          projected[i].z = p.y * sinTilt + z * cosTilt;
        });
        ctx.lineWidth = 0.55;
        edges.forEach(([i, j], index) => {
          const p = projected[i],
            q = projected[j];
          const depth = (p.z + q.z) / 2;
          if (depth < -0.1) return;
          ctx.strokeStyle = `rgba(139,91,61,${0.035 + Math.max(0, depth) * 0.14})`;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
          // Quiet signals travel across the front of the network.
          if (!reduced.matches && index % 83 === 0 && depth > 0.1) {
            const progress = (elapsed * 0.00018 + index * 0.137) % 1;
            const alpha = Math.sin(progress * Math.PI) * 0.8;
            ctx.fillStyle = `rgba(172,111,65,${alpha})`;
            ctx.beginPath();
            ctx.arc(p.x + (q.x - p.x) * progress, p.y + (q.y - p.y) * progress, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        });
        projected.forEach((p, i) => {
          const pulse = reduced.matches ? 0 : Math.max(0, Math.sin(elapsed * 0.0008 - points[i].y * 4)) * 0.15;
          ctx.fillStyle = `rgba(112,70,46,${0.12 + (p.z + 1) * 0.3 + pulse})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 0.55 + (p.z + 1) * 0.65, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      if (!reduced.matches) frame = requestAnimationFrame(draw);
    };
    const schedule = () => {
      dirty = true;
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      schedule();
    });
    resize.observe(canvas);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      schedule();
    });
    observer.observe(canvas);
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || reduced.matches) return;
      const bounds = canvas.getBoundingClientRect();
      pointer.targetX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 0.28;
      pointer.targetY = ((event.clientY - bounds.top) / bounds.height - 0.5) * 0.2;
    };
    const leave = () => {
      pointer.targetX = 0;
      pointer.targetY = 0;
    };
    canvas.addEventListener('pointermove', move, { passive: true });
    canvas.addEventListener('pointerleave', leave);
    document.addEventListener('visibilitychange', schedule);
    reduced.addEventListener('change', schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      observer.disconnect();
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', schedule);
      reduced.removeEventListener('change', schedule);
    };
  }, [minds]);
  return (
    <canvas
      ref={ref}
      className={styles.hiveCanvas}
      aria-label={
        minds === null
          ? 'Hive Mind illustration. Registered user count unavailable.'
          : `Hive Mind network representation of ${minds} registered users. Positions and signals are illustrative, not geographic or live activity.`
      }
      role="img"
    />
  );
}

function SoundControl() {
  const audio = useRef<AudioContext | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  async function toggle() {
    try {
      if (!audio.current) {
        const context = new AudioContext();
        audio.current = context;
        const master = context.createGain();
        master.gain.value = 0.075;
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 850;
        const delay = context.createDelay(2);
        delay.delayTime.value = 0.8;
        const feedback = context.createGain();
        feedback.gain.value = 0.3;
        filter.connect(master);
        filter.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(master);
        master.connect(context.destination);
        [130.81, 196, 261.63, 329.63, 392].forEach((frequency, i) => {
          const oscillator = context.createOscillator();
          oscillator.type = 'sine';
          oscillator.frequency.value = frequency;
          oscillator.detune.value = i % 2 ? 3 : -3;
          const gain = context.createGain();
          gain.gain.value = 0.16;
          const lfo = context.createOscillator();
          lfo.frequency.value = 0.055 + i * 0.013;
          const modulation = context.createGain();
          modulation.gain.value = 0.12;
          lfo.connect(modulation);
          modulation.connect(gain.gain);
          oscillator.connect(gain);
          gain.connect(filter);
          oscillator.start();
          lfo.start();
        });
      }
      if (playing) {
        await audio.current.suspend();
        setPlaying(false);
      } else {
        await audio.current.resume();
        setPlaying(true);
      }
      setError('');
    } catch {
      setError('Audio is unavailable in this browser.');
      setPlaying(false);
    }
  }
  return (
    <div className={styles.soundWrap}>
      <button className={styles.sound} onClick={toggle} aria-pressed={playing}>
        <span className={`${styles.wave} ${playing ? styles.waveOn : ''}`} aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </span>
        <span>{playing ? 'SOUND ON' : 'SOUND OFF'}</span>
      </button>
      <span role="status" className={styles.audioError}>
        {error}
      </span>
    </div>
  );
}

const Arrow = () => <span aria-hidden="true">↗</span>;

export default function LabsExperience({ initialNetwork }: { initialNetwork: NetworkSnapshot | null }) {
  const [network, setNetwork] = useState(initialNetwork);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch('/api/labs/network', { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        if (
          Number.isSafeInteger(data.registeredMinds) &&
          data.registeredMinds >= 0 &&
          typeof data.updatedAt === 'string' &&
          Number.isFinite(Date.parse(data.updatedAt))
        )
          setNetwork(data);
      } catch {
        /* Retain the last verified snapshot during temporary failures. */
      }
    };
    if (!initialNetwork) void refresh();
    const interval = window.setInterval(refresh, 300000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [initialNetwork]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const headings = root.current?.querySelectorAll<HTMLHeadingElement>('h1, [data-align-ink]');
    if (!headings?.length) return;
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return;
    let disposed = false;
    const alignInk = () => {
      if (disposed) return;
      root.current?.querySelectorAll<HTMLElement>('[data-headline-line]').forEach((line) => {
        const style = getComputedStyle(line);
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        // Align the visible letter edge, not the font's invisible side bearing.
        const offset = context.measureText(line.textContent?.trim().charAt(0) ?? '').actualBoundingBoxLeft;
        if (Number.isFinite(offset)) line.style.setProperty('--ink-offset', `${offset}px`);
      });
    };
    alignInk();
    void document.fonts.ready.then(alignInk);
    const resize = new ResizeObserver(alignInk);
    headings.forEach((heading) => resize.observe(heading));
    return () => {
      disposed = true;
      resize.disconnect();
    };
  }, []);
  useEffect(() => {
    const elements = root.current?.querySelectorAll('[data-reveal]');
    if (!elements) return;
    root.current?.classList.add(styles.motionReady);
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.revealed);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -24px 0px' },
    );
    elements.forEach((element) => observer.observe(element));
    return () => {
      observer.disconnect();
      root.current?.classList.remove(styles.motionReady);
    };
  }, []);
  function navigateSection(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!anchor || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const hash = anchor.getAttribute('href');
    const target = hash === '#' ? root.current : document.getElementById(hash?.slice(1) ?? '');
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
    window.history.replaceState(null, '', hash || '#');
    if (hash !== '#') {
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
  }
  return (
    <div ref={root} className={styles.page} onClick={navigateSection}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <a href="#" className={styles.brand} aria-label="Meera Labs home">
          <Image className={styles.brandMark} src="/labs/meera-logo.svg" width={36} height={36} alt="" />
          <span className={styles.brandWordmark}>meera</span><span className={styles.labs}>LABS</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#intelligence">Intelligence</a>
          <a href="#participation">Participation</a>
          <a href="#mission">Our mission</a>
        </nav>
        <Link href="/sign-in" className={styles.headerCta}>
          Meet Meera <Arrow />
        </Link>
      </header>
      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroContent}>
            <div className={styles.heroCopy}>
              <h1 id="hero-title">
                <span data-headline-line className={styles.heroLine}>
                  Conscious
                </span>
                <span data-headline-line className={styles.heroLine}>
                  Intelligence.
                </span>
                <span data-headline-line className={styles.heroLine}>
                  For everyone.
                </span>
              </h1>
              <p className={styles.heroDescription}>
                The world’s first Conscious Intelligence (CI).
                <br />
                Architected through a decentralised Hive Mind.
              </p>
              <a className={styles.textLink} href="#intelligence">
                Explore Meera Labs <span aria-hidden="true">↓</span>
              </a>
              <div className={styles.networkStats}>
                <div>
                  <strong>{network ? network.registeredMinds.toLocaleString('en-US') : '-'}</strong>
                  <span>REGISTERED MINDS</span>
                </div>
              </div>
            </div>
            <div className={styles.hiveArt}>
              <Hive minds={network?.registeredMinds ?? null} />
              <span className={styles.artLabel}>THE HIVE MIND</span>
              <details className={styles.networkNote}>
                <summary>About this network ↗</summary>
                <p>
                  {network
                    ? `Verified ${new Date(network.updatedAt).toISOString().slice(0, 10)} (UTC). `
                    : 'Count temporarily unavailable. '}
                  Registered Meera users, excluding deleted, internal, and test accounts. Positions and signals
                  illustrate the network; they do not show locations or live activity.{' '}
                  {network && network.registeredMinds > 2000
                    ? 'Points are grouped at this scale. '
                    : 'One point represents one registered user. '}
                  Country data is not yet available.
                </p>
              </details>
            </div>
          </div>
          <div className={styles.heroBottom}>
            <a href="#intelligence">
              SCROLL TO DISCOVER <span aria-hidden="true">↓</span>
            </a>
            <SoundControl />
          </div>
        </section>

        <section id="intelligence" className={styles.intelligence}>
          <div className={styles.sectionLabel}>
            <span>01 / THE NEW INTELLIGENCE</span>
            <span>CI</span>
          </div>
          <div className={styles.statement} data-reveal>
            <h2>
              One intelligence.
              <br />
              <span>Many minds.</span>
            </h2>
            <div>
              <p className={styles.lead}>The Hive Mind connects people and agents through a Collective Context Web.</p>
              <p className={styles.bodyCopy}>
                Every interaction adds context. Context deepens memory. Memory strengthens intelligence.
              </p>
              <a href="/whitepaper-v1.pdf" className={styles.textLink}>
                Read the whitepaper <Arrow />
              </a>
            </div>
          </div>
          <div className={styles.architecture} data-reveal>
            <span className={styles.archLabel}>THE COLLECTIVE CONTEXT WEB</span>
            <div className={styles.diagram}>
              <div>
                <span className={styles.smallNodes}>∴</span>
                <strong>People + agents</strong>
                <small>Experiences meet reasoning</small>
              </div>
              <span className={styles.connector} aria-hidden="true" />
              <div>
                <span className={styles.hiveSymbol}>✳</span>
                <strong>Context + memory</strong>
                <small>A shared web that deepens</small>
              </div>
              <span className={styles.connector} aria-hidden="true" />
              <div>
                <span className={styles.smallNodes}>◎</span>
                <strong>Emergent intelligence</strong>
                <small>The whole grows with each part</small>
              </div>
            </div>
          </div>
        </section>

        <section id="participation" className={styles.participation}>
          <div className={styles.sectionLabel}>
            <span>02 / A NEW PRIMITIVE</span>
            <span>PoC</span>
          </div>
          <div className={styles.participationGrid} data-reveal>
            <div className={styles.proofArt} aria-hidden="true">
              <div className={styles.proofRing} />
              <div className={styles.proofRing} />
              <div className={styles.proofRing} />
              <span>PoC</span>
              <small>PROOF OF CONSCIOUSNESS</small>
            </div>
            <div className={styles.proofCopy}>
              <h2>
                Presence.
                <br />
                Participation.
                <br />
                <em>Proof.</em>
              </h2>
              <p>
                Participation is measured and rewarded through a new primitive - Proof of Consciousness - settled in the{' '}
                <a
                  href="https://www.linkedin.com/search/results/all/?keywords=%23meera&amp;origin=HASH_TAG_FROM_FEED"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  #MEERA <Arrow />
                </a>{' '}
                token.
              </p>
              <p className={styles.protocolNote}>
                The whitepaper proposes rewards for valuable context, memory, and intelligence - weighted by
                contribution and reputation, for people and agents alike.
              </p>
              <a href="/whitepaper-v1.pdf" className={styles.textLink}>
                Explore the primitive <Arrow />
              </a>
            </div>
          </div>
          <div className={styles.principles}>
            <span>
              01 <strong>Contribution</strong>
              <small>Value over volume.</small>
            </span>
            <span>
              02 <strong>Reputation</strong>
              <small>Trust gives weight.</small>
            </span>
            <span>
              03 <strong>Participation</strong>
              <small>People and agents.</small>
            </span>
          </div>
        </section>

        <section id="mission" className={styles.mission}>
          <div className={styles.sectionLabel}>
            <span>03 / OUR NORTH STAR</span>
            <span>CSI</span>
          </div>
          <div data-reveal>
            <p className={styles.eyebrow}>OUR MISSION IS SINGULAR.</p>
            <h2>
              Singularity through
              <br />
              decentralised Conscious
              <br />
              <em>Superintelligence.</em>
            </h2>
            <p>India-born. Globally oriented. Built around a shared future.</p>
          </div>
          <div className={styles.missionLine} aria-hidden="true">
            <span>INDIVIDUAL</span>
            <i />
            <span>COLLECTIVE</span>
            <i />
            <span>SUPERINTELLIGENCE</span>
          </div>
        </section>

        <section id="companion" className={styles.companion}>
          <div className={styles.sectionLabel}>
              <span>04 / OUR PRODUCT</span>
            <span>MEERA</span>
          </div>
          <div className={styles.companionGrid} data-reveal>
            <div className={styles.companionArt} aria-hidden="true">
              <div className={styles.companionOrb} />
              <span>meera</span>
            </div>
            <div className={styles.companionCopy}>
              <h2>Your Personal Companion.</h2>
              <p className={styles.companionDescription}>
                Meet Meera. Designed to remember, evolve, and understand you.
                For companionship. For curiosity. For everyday life.
              </p>
              <Link className={styles.button} href="/sign-in">
                Meet your companion <Arrow />
              </Link>
            </div>
          </div>
        </section>
        <section className={styles.indiaClosing} aria-labelledby="india-title">
          <div className={styles.sectionLabel}>
            <span>05 / ROOTS AND HORIZONS</span>
            <span>INDIA → WORLD</span>
          </div>
          <div className={styles.companionGrid} data-reveal>
            <div className={styles.indiaStatement}>
              <h2 id="india-title">
                From India.
                <br />
                <em>For the world.</em>
              </h2>
              <p className={styles.indiaLead}>
                At the frontier of intelligence, we carry the courage to imagine - and the responsibility to build for
                everyone.
              </p>
            </div>
            <figure className={styles.indiaArtwork}>
              <Image
                src="/labs/rama-ashwamedha-drawing.webp"
                width={1499}
                height={1049}
                sizes="(max-width: 700px) 300px, (max-width: 1600px) 45vw, 720px"
                alt="Hand-drawn interpretation of Rama’s Ashwamedha yajna from the Ramayana, with Rama, sages, Sita’s effigy, and the ceremonial horse."
              />
              <figcaption>RAMA’S ASHWAMEDHA · RAMAYANA</figcaption>
            </figure>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <div className={styles.companyIdentity}>
          <span>CORPORATE IDENTITY</span>
          <div>
            <strong>Meera Labs Inc.</strong>
            <p>Legal company name</p>
          </div>
        </div>
        <div className={styles.footerTop}>
          <a href="#" className={styles.brand}>
            <Image className={styles.brandMark} src="/labs/meera-logo.svg" width={36} height={36} alt="" />
            <span className={styles.brandWordmark}>meera</span><span className={styles.labs}>LABS</span>
          </a>
          <p>
            A conscious future.
            <br />A collective beginning.
          </p>
          <a href="#main" className={styles.textLink}>
            Back to the beginning ↑
          </a>
        </div>
        <div className={styles.footerBottom}>
          <span>© {new Date().getFullYear()} Meera Labs Inc.</span>
          <div>
            <a href="/whitepaper-v1.pdf">Whitepaper</a>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
          <span>INTELLIGENCE, CONSCIOUSLY CONNECTED.</span>
        </div>
      </footer>
    </div>
  );
}
