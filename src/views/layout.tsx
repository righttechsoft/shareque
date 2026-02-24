import type { FC } from "hono/jsx";

type LayoutProps = {
  title?: string;
  children: any;
  hideNav?: boolean;
};

export const Layout: FC<LayoutProps> = ({ title, children, hideNav }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title ? `${title} - Shareque` : "Shareque"}</title>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
        />
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <main class="container">
          {!hideNav && (
            <nav>
              <ul>
                <li>
                  <strong>
                    <a href="/dashboard" class="nav-brand">Shareque</a>
                  </strong>
                </li>
              </ul>
              <ul>
                <li>
                  <a href="/dashboard">Dashboard</a>
                </li>
                <li>
                  <form method="POST" action="/logout" style="margin:0">
                    <button type="submit" class="outline secondary btn-sm">
                      Logout
                    </button>
                  </form>
                </li>
              </ul>
            </nav>
          )}
          {children}
        </main>
        <script src="/client.js"></script>
      </body>
    </html>
  );
};

export const MinimalLayout: FC<{ title?: string; children: any }> = ({
  title,
  children,
}) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title ? `${title} - Shareque` : "Shareque"}</title>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
        />
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <main class="container">{children}</main>
        <script src="/client.js"></script>
      </body>
    </html>
  );
};
