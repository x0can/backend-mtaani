module.exports = {
  productCreated(io, product) {
    io.emit("product:created", product);
  },
};
