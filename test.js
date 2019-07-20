var la = require('./losangeles')

var options = {
    contentPath: "./testfiles/",
    $cache: {},
};


it("Parse Page", async () => {

    var page = await la.parsePageFileAsync("./testfiles/basic.page");
    expect(page.prop1).toEqual("Hello World");
    expect(page.prop2).toEqual(23);
    expect(page.prop3).toEqual(true);
    expect(page.rawBody).toEqual("# Heading 1");
    expect(page.filename).toEqual("./testfiles/basic.page");

});

it("Common.page and Single Import", async () => {

    var page = await la.loadPageFileAsync(options, "./testfiles/basic.page");
    expect(page.prop1).toEqual("Hello World");
    expect(page.filename).toEqual("./testfiles/basic.page");
    expect(page.commonProp1).toEqual("common");
    expect(page.importedProp1).toEqual("imported");

});

it("Multiple Imports", async () => {

    var page = await la.loadPageFileAsync(options, "./testfiles/multipleImports.page");
    expect(page.importedProp1).toEqual("imported");
    expect(page.importedProp2).toEqual("imported2");

});

it("Map URL page", async() => {

    var [file, url] = await la.mapUrlToFileAsync(options, "/basic");
    expect(file).toEqual("/basic.page");

});

it("Map URL to .md if exists", async() => {

    var [file, url] = await la.mapUrlToFileAsync(options, "/markdown");
    expect(file).toEqual("/markdown.md");

});

it("Map root URL to root index page", async() => {

    var [file, url] = await la.mapUrlToFileAsync(options, "/");
    expect(file).toEqual("/index.page");

});

it("Map directory URL to directory index page", async() => {

    var [file, url] = await la.mapUrlToFileAsync(options, "/subdir");
    expect(file).toEqual("/subdir/index.page");

});


it("Calculates normal image size correctly", () => {

    var imageSize = la.getImageSize("./testfiles/subdir/banner.png");
    expect(imageSize).toEqual({width:2040, height:728, type: "png"});

});

it("Caches image sizes correctly", () => {

    var imageSize1 = la.getImageSize("./testfiles/subdir/banner.png");
    var imageSize2 = la.getImageSize("./testfiles/subdir/banner.png");
    expect(imageSize1).toBe(imageSize2);

});

it("Calculates retina image size correctly", () => {

    var imageSize = la.getImageSize("./testfiles/subdir/banner@2x.png");
    expect(imageSize).toEqual({width:1020, height:364, type: "png"});

});

it("Load page from url", async() => {

    var page = await la.loadPageAsync(options, "/basic");
    expect(page.url).toEqual("/basic");
    expect(page.filename).toEqual("/basic.page");
    expect(page.rawBody).toEqual("# Heading 1")
    expect(page.body).toEqual("<h1 id=\"heading-1\">Heading 1</h1>\n")
    expect(page.view).toEqual("page");
    expect(page.options).toEqual(options);

});

it("Loaded page helper functions", async() => {

    var page = await la.loadPageAsync(options, "/subdir/");
    expect(page.url).toEqual("/subdir/");
    expect(page.filename).toEqual("/subdir/index.page");
    expect(page.options).toEqual(options);
    expect(page.qualifyUrl("otherpage")).toEqual("/subdir/otherpage");
    expect(page.getImageSize("banner@2x.png")).toEqual({width: 1020, height:364, type:"png"});
    expect((await page.loadPageAsync("other")).title).toEqual("Other");

});

it("Loads external body", async() => {

    var page = await la.loadPageAsync(options, "/externalBody");
    expect(page.body).toContain("Welcome to Moe-js");
    
});

it("Acknowledges noMarkdown option", async() => {

    var page = await la.loadPageAsync(options, "/subdir/noMarkdown");
    expect(page.body).toEqual("# Body");

});


it("Formats Markdown code blocks correctly", async() => {

    var page = await la.loadPageAsync(options, "/subdir/markdown");
    expect(page.body).toContain("language-html");
    expect(page.body).toContain("&lt;p&gt;");

});

it("Includes image size in markdown referenced images", async() => {

    var page = await la.loadPageAsync(options, "/subdir/markdown");
    expect(page.body).toContain("width=\"1020\"");
    expect(page.body).toContain("height=\"364\"");

});

it("Caches pages", async() => {

    var page1 = await la.loadPageAsync(options, "/subdir/");
    var page2 = await la.loadPageAsync(options, "/subdir/");
    expect(page1).toBe(page2);

});
