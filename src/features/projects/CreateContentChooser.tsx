import { ChevronLeft } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../shared/ui/Icon";
import { useHeightMotion } from "../../shared/ui/motion";
import type { Format } from "./generation-response";

const formatIcons = {
  x_posts: "message", linkedin_posts: "briefcase", blogs: "article",
  newsletters: "mail", carousels: "slides", short_videos: "video",
} as const;

export function ContentFormatIcon({ format }: { format: Format }) {
  return <span className="generation-format-icon"><Icon name={formatIcons[format]} size={22} /></span>;
}

export function CreateContentChooser({ children, footer, title, description, open, onOpenChange, onBack, onOpen, onCloseAutoFocus, triggerMount }: {
  children: ReactNode;
  triggerMount?: HTMLElement | null;
  footer?: ReactNode;
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
  onOpen?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const id = useId();
  const contentMotion = useHeightMotion();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const lastFormat = useRef<string | null>(null);
  const wasOptions = useRef(false);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    body.current?.scrollTo({ top: 0 });
    const tile = !onBack && wasOptions.current && lastFormat.current
      ? body.current?.querySelector<HTMLButtonElement>(`[data-format="${lastFormat.current}"]`)
      : null;
    (tile ?? heading.current)?.focus({ preventScroll: true });
    wasOptions.current = !!onBack;
  }, [open, title, !!onBack]);
  const launcher = <div className="create-content-chooser"><Button ref={trigger} className="button button-primary" aria-haspopup="dialog" onClick={() => { onOpen?.(); onOpenChange(true); }}>
      <Icon name="plus" size={18} /> Create content
    </Button></div>;
  return <>
    {triggerMount ? createPortal(launcher, triggerMount) : triggerMount === undefined ? launcher : null}
    {createPortal(<dialog ref={dialog} className="create-content-dialog" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined}
      onCancel={event => { event.preventDefault(); onOpenChange(false); }}
      onClose={() => {
        const event = new Event("closeAutoFocus", { cancelable: true });
        onCloseAutoFocus?.(event);
        if (!event.defaultPrevented && trigger.current?.isConnected) trigger.current.focus();
      }}>
      <div className="create-content-top">
        <ol className="create-content-steps" aria-label="Creation steps">
          <li aria-current={!onBack ? "step" : undefined}><span>1</span> Format</li>
          <li aria-current={onBack ? "step" : undefined}><span>2</span> Options</li>
        </ol>
        <Button variant="ghost" className="create-content-close" aria-label="Close creation" onClick={() => onOpenChange(false)}><Icon name="close" size={20} /></Button>
      </div>
      <div ref={body} className="create-content-body" onClickCapture={event => {
        const tile = (event.target as HTMLElement).closest<HTMLElement>("[data-format]");
        if (tile) lastFormat.current = tile.dataset.format ?? null;
      }}>
        {onBack && <Button variant="ghost" className="create-content-back" onClick={onBack}><ChevronLeft size={16} aria-hidden="true" /> Change format</Button>}
        <h2 ref={heading} tabIndex={-1} id={`${id}-title`}>{title}</h2>
        {description && <p className="create-content-description" id={`${id}-description`}>{description}</p>}
        <div ref={contentMotion}><div>{children}</div></div>
      </div>
      {footer && <div className="create-content-footer">{footer}</div>}
    </dialog>, document.body)}
  </>;
}
