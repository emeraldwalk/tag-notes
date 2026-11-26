import { createSignal, type JSX, Show } from 'solid-js';
import NavBar, { type NavBarBack } from './NavBar';
import styles from './Page.module.css';

export interface PageProps {
  title: string;
  /**
   * A tab's root screen: a large title at the top of the content that hands over to the nav bar's small one as it
   * scrolls away, like iOS. Pushed screens (back button) keep the small title.
   */
  large?: boolean;
  back?: NavBarBack;
  leading?: JSX.Element;
  trailing?: JSX.Element;
  /** Content stretches to the screen's height (an editor) instead of scrolling as a stack of sections. */
  fill?: boolean;
  children?: JSX.Element;
}

/** Scrolled past this, the large title is mostly gone: show the small one. */
const LARGE_TITLE_HANDOFF_PX = 30;

/** One screen: a nav bar pinned at the top and a body that scrolls under it. */
function Page(props: PageProps) {
  const [scrolled, setScrolled] = createSignal(false);

  return (
    <div class={styles.page}>
      <NavBar
        title={props.title}
        back={props.back}
        leading={props.leading}
        trailing={props.trailing}
        titleHidden={props.large && !scrolled()}
        scrollEdge={!scrolled()}
      />
      <div
        class={styles.body}
        classList={{ [styles.fill]: props.fill }}
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > (props.large ? LARGE_TITLE_HANDOFF_PX : 0))}
      >
        <Show when={props.large}>
          <h1 class={styles.largeTitle}>{props.title}</h1>
        </Show>
        {props.children}
      </div>
    </div>
  );
}

export default Page;
