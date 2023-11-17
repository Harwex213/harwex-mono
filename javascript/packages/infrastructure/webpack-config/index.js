import path from "path";
import { fileURLToPath } from "url";
import HtmlWebpackPlugin from "html-webpack-plugin";
import MiniCssExtractPlugin from "mini-css-extract-plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const createBaseConfig = (options = {}) => {
    const {
        entry = "./src/index.ts",
        outputPath = "dist",
        templatePath = "./src/index.html",
        isDevelopment = process.env.NODE_ENV !== "production"
    } = options;

    return {
        entry,
        output: {
            path: path.resolve(process.cwd(), outputPath),
            filename: isDevelopment ? "[name].js" : "[name].[contenthash].js",
            clean: true
        },
        resolve: {
            extensions: [".ts", ".tsx", ".js", ".jsx"],
            alias: {
                "@": path.resolve(process.cwd(), "src")
            }
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    use: [
                        {
                            loader: "ts-loader",
                            options: {
                                transpileOnly: isDevelopment,
                                configFile: path.resolve(process.cwd(), "tsconfig.json")
                            }
                        }
                    ],
                    exclude: /node_modules/
                },
                {
                    test: /\.css$/,
                    use: [
                        isDevelopment ? "style-loader" : MiniCssExtractPlugin.loader,
                        "css-loader"
                    ]
                }
            ]
        },
        plugins: [
            new HtmlWebpackPlugin({
                template: path.resolve(process.cwd(), templatePath),
                filename: "index.html"
            }),
            ...(isDevelopment ? [] : [new MiniCssExtractPlugin({
                filename: "[name].[contenthash].css"
            })])
        ],
        devServer: {
            static: {
                directory: path.resolve(process.cwd(), outputPath)
            },
            port: 3000,
            hot: true,
            open: true,
            historyApiFallback: true
        },
        devtool: isDevelopment ? "eval-source-map" : "source-map"
    };
};