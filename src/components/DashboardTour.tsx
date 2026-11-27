"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Compass } from "lucide-react";
import { buttonClass } from "./dashboard-ui";
import styles from "./DashboardTour.module.css";

const steps = [
  { target: "metrics", title: "Your business at a glance", description: "See how many leads came in, what needs review, and the orders and revenue you’ve recorded." },
  { target: "actions", title: "Know what to do next", description: "Start here for payment reminders, buying signals, and conversations that need a follow-up." },
  { target: "conversations", title: "Catch up on conversations", description: "See the latest customer messages here. Open the inbox to read the full conversation." },
  { target: "workspace", title: "Manage your workspace", description: "Check whether WhatsApp is connected and jump to Settings or your orders and outcomes." },
] as const;

const storagePrefix = "pipelixr-dashboard-tour-v1:";
const tourChangeEvent = "pipelixr-dashboard-tour-change";
const finishedTours = new Set<string>();

function subscribeToTour(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(tourChangeEvent, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(tourChangeEvent, notify);
  };
}

export default function DashboardTour({ businessId }: { businessId: string }) {
  const storageKey = `${storagePrefix}${businessId}`;
  const [replaying, setReplaying] = useState(false);
  const launchButton = useRef<HTMLButtonElement>(null);
  const hasSeenTour = useSyncExternalStore(subscribeToTour, () => {
    try {
      return finishedTours.has(storageKey) || window.localStorage.getItem(storageKey) === "seen";
    } catch {
      return finishedTours.has(storageKey);
    }
  }, () => true);

  const finish = useCallback(() => {
    try {
      window.localStorage.setItem(storageKey, "seen");
    } catch {
      finishedTours.add(storageKey);
    }
    setReplaying(false);
    window.dispatchEvent(new Event(tourChangeEvent));
  }, [storageKey]);

  return <>
    <button ref={launchButton} type="button" className={buttonClass.ghost} onClick={() => setReplaying(true)}><Compass size={15} aria-hidden="true" />Take a tour</button>
    {(!hasSeenTour || replaying) && <SpotlightTour onFinish={finish} launchButton={launchButton} />}
  </>;
}

function SpotlightTour({ onFinish, launchButton }: { onFinish: () => void; launchButton: { current: HTMLButtonElement | null } }) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const spotlightRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  useLayoutEffect(() => {
    const card = cardRef.current;
    const spotlight = spotlightRef.current;
    if (!card || !spotlight) return;
    const target = document.querySelector<HTMLElement>(`[data-dashboard-tour="${step.target}"]`);
    target?.scrollIntoView({ block: "center", behavior: "instant" });
    headingRef.current?.focus({ preventScroll: true });

    function moveSpotlight() {
      if (!card || !spotlight) return;
      const gap = 14;
      const padding = 7;
      const width = document.documentElement.clientWidth;
      const height = document.documentElement.clientHeight;
      const { offsetWidth: cardWidth, offsetHeight: cardHeight } = card;
      const rect = target?.getBoundingClientRect();
      const maxTop = Math.max(gap, height - cardHeight - gap);

      if (!rect || rect.top >= height || rect.bottom <= 0 || rect.left >= width || rect.right <= 0 || !rect.width || !rect.height) {
        spotlight.hidden = true;
        card.style.left = `${(width - cardWidth) / 2}px`;
        card.style.top = `${Math.max(gap, (height - cardHeight) / 2)}px`;
        return;
      }

      const left = Math.max(0, rect.left - padding);
      const right = Math.min(width, rect.right + padding);
      const top = Math.max(0, rect.top - padding);
      const bottom = Math.min(height, rect.bottom + padding);
      spotlight.hidden = false;
      spotlight.style.left = `${left}px`;
      spotlight.style.top = `${top}px`;
      spotlight.style.width = `${right - left}px`;
      spotlight.style.height = `${bottom - top}px`;

      const above = top - cardHeight - gap;
      const below = bottom + gap;
      const cardTop = below <= maxTop ? below : above >= gap ? above : top > height - bottom ? gap : maxTop;
      const cardLeft = Math.max(gap, Math.min(left, width - cardWidth - gap));
      card.style.left = `${cardLeft}px`;
      card.style.top = `${cardTop}px`;
    }

    moveSpotlight();
    let frame = 0;
    function measure() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(moveSpotlight);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    observer.observe(card);
    if (target) observer.observe(target);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step.target]);

  function finish() {
    dialogRef.current?.close();
    launchButton.current?.focus();
    onFinish();
  }

  return <dialog ref={dialogRef} className={styles.overlay} aria-labelledby={titleId} aria-describedby={bodyId} onCancel={(event) => { event.preventDefault(); finish(); }}>
    <div ref={spotlightRef} className={styles.spotlight} aria-hidden="true" hidden />
    <div ref={cardRef} className={styles.card}>
      <p className={styles.progress}><Compass size={14} aria-hidden="true" />Quick tour · {stepIndex + 1} of {steps.length}</p>
      <h2 ref={headingRef} id={titleId} tabIndex={-1}>{step.title}</h2>
      <p id={bodyId} className={styles.description}>{step.description}</p>
      <div className={styles.actions}>
        <button type="button" className={buttonClass.ghost} onClick={finish}>Skip tour</button>
        <button type="button" className={buttonClass.primary} onClick={() => stepIndex === steps.length - 1 ? finish() : setStepIndex(stepIndex + 1)}>Okay, got it!</button>
      </div>
    </div>
  </dialog>;
}
