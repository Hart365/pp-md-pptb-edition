import { describe, expect, it } from 'vitest';
import { transformHtmlForPptb } from '../../vite.config';

describe('PPTB HTML transformation', () => {
  it('moves external scripts and handles whitespace before closing tags', () => {
    const html = '<html><body><div id="root"></div><script type="module" crossorigin src="/app.js"></script ><script src="/vendor.js" type=module ></script></body></html>';

    expect(transformHtmlForPptb(html)).toBe(
      '<html><body><div id="root"></div>  <script src="/app.js"></script >\n'
      + '  <script src="/vendor.js" ></script>\n</body></html>',
    );
  });

  it('ignores scripts inside comments and removes crossorigin without rewriting unrelated attributes', () => {
    const html = '<html><body><!-- <script type="module" src="/comment.js"></script> -->'
      + '<div type="module" crossorigin></div><script type="module">run()</script></body></html>';

    expect(transformHtmlForPptb(html)).toBe(
      '<html><body><!-- <script type="module" src="/comment.js"></script> -->'
      + '<div type="module"></div><script>run()</script></body></html>',
    );
  });
});
