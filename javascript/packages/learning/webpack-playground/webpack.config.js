const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssModulePreprocessorPlugin = require('./webpack-plugins/CssModulePreprocessorPlugin');

const isDev = process.env.NODE_ENV !== 'production';

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.(png|jpe?g|gif|svg|webp)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/[name].[contenthash][ext][query]',
        },
      },
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env', '@babel/preset-react'],
          },
        },
      },
      {
        test: /\.module\.css$/,
        use: [
          isDev ? 'style-loader' : MiniCssExtractPlugin.loader,
          {
            loader: "css-loader",
            options: {
              modules: {
                localIdentName: isDev ? '[local]--[hash:base64:5]' : '[local]--[contenthash:base64:5]',
                exportLocalsConvention: 'camelCase',
                namedExport: false,
              },
              importLoaders: 1,
            },
          },
        ],
      },
      {
        test: /\.css$/,
        exclude: /\.module\.css$/,
        use: [
          isDev ? 'style-loader' : MiniCssExtractPlugin.loader,
          'css-loader',
        ],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './public/index.html',
      filename: 'index.html',
    }),
    !isDev &&
    new MiniCssExtractPlugin({
      filename: '[name].[fullhash].css',
      chunkFilename: '[name].[fullhash].css',
      ignoreOrder: true,
    }),
    new CssModulePreprocessorPlugin({
      overrideRoots: [path.resolve(__dirname, 'src/themes/green')],
    }),
  ].filter(Boolean),
  devServer: {
    static: {
      directory: path.join(__dirname, 'public'),
    },
    compress: true,
    port: 3000,
    hot: true,
    open: true,
  },
  resolve: {
    extensions: ['.js', '.jsx'],
  },
};
