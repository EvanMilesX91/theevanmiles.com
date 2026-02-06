// Custom element type declarations for third-party widgets

declare namespace JSX {
  interface IntrinsicElements {
    'behold-widget': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        'feed-id'?: string;
      },
      HTMLElement
    >;
  }
}

export {};