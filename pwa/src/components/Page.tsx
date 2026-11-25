import type { JSX } from 'solid-js';
import styles from './Page.module.css';

export interface PageProps {
  /** The screen's NavBar. */
  nav: JSX.Element;
  /** Content stretches to the screen's height (an editor) instead of scrolling as a stack of sections. */
  fill?: boolean;
  children?: JSX.Element;
}

/** One screen: a nav bar pinned at the top and a body that scrolls under it. */
function Page(props: PageProps) {
  return (
    <div class={styles.page}>
      {props.nav}
      <div class={styles.body} classList={{ [styles.fill]: props.fill }}>
        {props.children}
      </div>
    </div>
  );
}

export default Page;
