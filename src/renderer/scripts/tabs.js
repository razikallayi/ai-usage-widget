class TabController {
  constructor() {
    this.tabs = [];
    this.pages = [];
    this.activeIndex = 0;
    this.onSwitch = null;
  }

  init(tabEls, pageEls) {
    this.tabs = Array.from(tabEls);
    this.pages = Array.from(pageEls);

    this.tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => this.switchTo(i));
    });

    this.switchTo(0);
  }

  switchTo(index) {
    this.activeIndex = index;

    this.tabs.forEach((tab, i) => {
      tab.classList.toggle('active', i === index);
    });

    this.pages.forEach((page, i) => {
      page.classList.toggle('active', i === index);
    });

    if (this.onSwitch) this.onSwitch(index);
  }

  getActiveIndex() {
    return this.activeIndex;
  }
}

window.TabController = TabController;
