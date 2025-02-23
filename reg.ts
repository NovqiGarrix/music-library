const url = "https://music-library-r2.nvhub.my.id/ILLENIUM/ILLENIUM - Starfall (Official Visualizer).opus";
const regex = /ILLENIUM\/.*?\//;
console.log(url.match(regex)); // Will match the '/' after ILLENIUM