import type { AppProps } from "next/app";

// Framework file — must be excluded from the product map (not a screen).
export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
