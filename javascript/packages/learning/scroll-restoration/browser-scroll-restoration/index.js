import { compilePath, div, link, switcher } from "@hw/html-lib";

const routeOne = () => {
  const container = div({ style: { height: "200dvh", background: "silver", color: "gold" } }).children([
    div().content("Zdarova"),
    div({ style: { position: "absolute", top: "100%" } }).child(link({ href: "/route-two" }).content("route two")),
  ]);

  // window.scrollTo(0, 0);

  return container;
}

const routeTwo = () => {
  const container = div({ style: { height: "200dvh", background: "gold", color: "silver" } }).children([
    div().content("Zdarova"),
    div({ style: { position: "absolute", top: "100%" } }).child(link({ href: "/route-one" }).content("route one")),
  ]);

  // window.scrollTo(0, 0);

  return container;
}

window.history.scrollRestoration = "auto";

const main = () => {
  const container = div();

  const siteContent = div();

  container.addFinalizer(
    switcher()
      .match(compilePath("/route-one"), () => siteContent.child(routeOne()))
      .match(compilePath("/route-two"), () => siteContent.child(routeTwo()))
      .match(compilePath("/default"), () => siteContent.children([
            div().child(link({ href: "/route-one" }).content("route one")),
            div().child(link({ href: "/route-two" }).content("route two")),
          ]
        )
      )
      .defaultPath("/default")
      .listen()
  );

  const scrollPosition = div({
    style: {
      position: "fixed",
      top: "100px",
      right: "100px",
      color: "red",
      fontSize: "20px",
    }
  }).content(window.scrollY);

  const updateScrollPosition = () => {
    scrollPosition.content(window.scrollY);
  }

  window.addEventListener("scroll", updateScrollPosition);
  scrollPosition.addFinalizer(() => window.removeEventListener("scroll", updateScrollPosition));

  container.children([
    siteContent,
    scrollPosition,
  ])

  return container;
}

document.getElementById("root").appendChild(main().htmlElement);
