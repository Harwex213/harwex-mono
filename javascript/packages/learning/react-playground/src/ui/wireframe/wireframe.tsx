import clsx from "clsx";
import { router } from "../router-di";
import classes from "./wireframe.module.css";

const Wireframe = () => {
    return (
        <div className={clsx(classes.variables, classes.container)}>
            <div className={classes.leftSidebar}>
                <h1>Wireframe</h1>
            </div>

            <div className={classes.content}>
                <div className={classes.cart}>
                    <div className={classes.cartHeader}>
                        <h2>Cart</h2>
                    </div>

                    <div className={classes.cartBody}>
                        <div className={classes.cartItem}>
                            <p>
                                Item 1
                            </p>

                            <div className={classes.cartItemImage}>
                                <img src="https://via.placeholder.com/150" alt="Cart Item" />
                            </div>
                        </div>
                    </div>
                </div>

                <div className={classes.cart}>
                    <div className={classes.cartHeader}>
                        <h2>Cart</h2>
                    </div>

                    <div className={classes.cartBody}>
                        <div className={classes.cartItem}>
                            <p>
                                Item 2
                            </p>

                            <div className={classes.cartItemImage}>
                                <img src="https://via.placeholder.com/150" alt="Cart Item" />
                            </div>
                        </div>
                    </div>
                </div>

                <div className={classes.cart}>
                    <div className={classes.cartHeader}>
                        <h2>Cart</h2>
                    </div>

                    <div className={classes.cartBody}>
                        <div className={classes.cartItem}>
                            <p>
                                Item 3
                            </p>

                            <div className={classes.cartItemImage}>
                                <img src="https://via.placeholder.com/150" alt="Cart Item" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}


router.registerRoute("/wireframe", Wireframe);